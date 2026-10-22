package github.gtouming.what_guys_doing.web;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 玩家皮肤/披风缓存：浏览器不能直接访问 Mojang CDN（CORS），由服务端按 UUID 取 profile → PNG。
 * 失败一律回退默认 wide/steve；披风缺失时返回 null。
 */
public final class SkinCache {
    private static final Map<String, byte[]> MEMORY = new ConcurrentHashMap<>();
    private static final Map<String, String> MODELS = new ConcurrentHashMap<>();
    private static final Map<String, byte[]> CAPES = new ConcurrentHashMap<>();
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private static final Pattern VALUE = Pattern.compile("\"value\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern URL = Pattern.compile("\"url\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern CAPE = Pattern.compile("\"CAPE\"\\s*:\\s*\\{[^}]*\"url\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern MODEL = Pattern.compile("\"model\"\\s*:\\s*\"(slim|wide)\"");

    public record Skin(byte[] bytes, String model, byte[] cape) {
    }

    private SkinCache() {
    }

    public static Skin get(String uuid, byte[] fallback, Path cacheDir) {
        String id = uuid == null ? "" : uuid.replace("-", "").toLowerCase();
        if (!id.matches("[0-9a-f]{32}")) {
            return new Skin(fallback, "wide", null);
        }
        if (cacheDir == null) {
            return new Skin(fallback, "wide", null);
        }
        byte[] cached = MEMORY.get(id);
        if (cached != null) {
            return new Skin(cached, MODELS.getOrDefault(id, "wide"), CAPES.get(id));
        }
        Path file = cacheDir.resolve(id + ".png");
        Path modelFile = cacheDir.resolve(id + ".model");
        Path capeFile = cacheDir.resolve(id + ".cape.png");
        try {
            if (Files.isRegularFile(file)) {
                byte[] body = Files.readAllBytes(file);
                String model = Files.isRegularFile(modelFile)
                        ? Files.readString(modelFile, StandardCharsets.UTF_8).trim()
                        : "wide";
                if (!"slim".equals(model)) model = "wide";
                byte[] cape = Files.isRegularFile(capeFile) ? Files.readAllBytes(capeFile) : null;
                MEMORY.put(id, body);
                MODELS.put(id, model);
                if (cape != null) CAPES.put(id, cape);
                return new Skin(body, model, cape);
            }
        } catch (Exception ignored) {
        }
        try {
            String profileUrl = "https://sessionserver.mojang.com/session/minecraft/profile/" + id;
            HttpResponse<String> profile = CLIENT.send(
                    HttpRequest.newBuilder(URI.create(profileUrl))
                            .timeout(Duration.ofSeconds(5)).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            Matcher value = VALUE.matcher(profile.body());
            if (!value.find()) {
                return new Skin(fallback, "wide", null);
            }
            String decoded = new String(Base64.getDecoder().decode(value.group(1)), StandardCharsets.UTF_8);
            Matcher url = URL.matcher(decoded);
            if (!url.find()) {
                return new Skin(fallback, "wide", null);
            }
            Matcher modelMatcher = MODEL.matcher(decoded);
            String model = modelMatcher.find() ? modelMatcher.group(1) : "wide";
            String skinUrl = url.group(1).replace("http://", "https://");
            HttpResponse<byte[]> skin = CLIENT.send(
                    HttpRequest.newBuilder(URI.create(skinUrl))
                            .timeout(Duration.ofSeconds(8)).GET().build(),
                    HttpResponse.BodyHandlers.ofByteArray());
            byte[] body = skin.body();
            if (body == null || body.length < 8) {
                return new Skin(fallback, "wide", null);
            }
            byte[] cape = null;
            Matcher capeMatcher = CAPE.matcher(decoded);
            if (capeMatcher.find()) {
                try {
                    String capeUrl = capeMatcher.group(1).replace("http://", "https://");
                    HttpResponse<byte[]> capeResponse = CLIENT.send(
                            HttpRequest.newBuilder(URI.create(capeUrl))
                                    .timeout(Duration.ofSeconds(8)).GET().build(),
                            HttpResponse.BodyHandlers.ofByteArray());
                    byte[] capeBody = capeResponse.body();
                    if (capeBody != null && capeBody.length >= 8) {
                        cape = capeBody;
                    }
                } catch (Exception ignored) {
                }
            }
            Files.createDirectories(cacheDir);
            Files.write(file, body);
            Files.writeString(modelFile, model, StandardCharsets.UTF_8);
            if (cape != null) Files.write(capeFile, cape);
            MEMORY.put(id, body);
            MODELS.put(id, model);
            if (cape != null) CAPES.put(id, cape);
            return new Skin(body, model, cape);
        } catch (Exception ignored) {
            return new Skin(fallback, "wide", null);
        }
    }
}
