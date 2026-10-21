package github.gtouming.what_guys_doing.web;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * 原版资产通路：浏览器拿不到 Mojang CDN（无 CORS 头），所以由模组在**工作线程**一次性抓取
 * client jar、抽出所需条目缓存到磁盘，再由内置 HTTP 服务分发给浏览器。
 * 模组不分发任何 Mojang 资产，只在用户机器上本地抓取与缓存。
 */
public final class AssetCache {
    private static final Logger LOGGER = LoggerFactory.getLogger("what_guys_doing/assets");
    private static final String VERSION_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    private static final String MINECRAFT_VERSION = "1.21.1";
    /** 只抽这些前缀（相对 assets/），避免解出整个 client jar。 */
    private static final String[] WANTED_PREFIXES = {
            "minecraft/blockstates/",
            "minecraft/models/block/",
            "minecraft/models/item/",
            "minecraft/textures/block/",
            "minecraft/textures/item/",
            "minecraft/textures/colormap/",
            // 模型将由自研生成器从 1.21.1 原版代码产出，实体贴图也用 1.21.1，保证同版本。
            "minecraft/textures/entity/",
    };
    /**
     * 实体贴图的来源版本。**必须与实体模型同版本**：模型来自 1.21.1 原版代码（自研生成器），
     * 贴图布局与模型 uv 强耦合。
     */
    private static final String ENTITY_VERSION = "1.21.1";
    /** 缓存格式版本：改变抽取内容时必须 +1，否则老缓存会缺文件。 */
    private static final int CACHE_FORMAT = 7;
    private static final long MAX_SERVED_FILE = 32L * 1024 * 1024;

    public enum State {
        IDLE, MANIFEST, DOWNLOADING, EXTRACTING, READY, FAILED
    }

    /** 供 HTTP 分发的文件条目。 */
    public record FileEntry(byte[] data, String etag, String contentType) {
    }

    private final Path root;
    private final Path jarsDir;
    private final Path contentDir;
    private final Path packsDir;
    private final boolean keepClientJar;

    private volatile State state = State.IDLE;
    private volatile String message = "idle";
    private volatile long downloadedBytes;
    private volatile long totalBytes;
    private volatile int entryCount;
    private volatile int packCount;
    private volatile long startedAtMillis;
    private volatile long finishedAtMillis;
    private final AtomicLong servedRequests = new AtomicLong();
    private final AtomicLong servedBytes = new AtomicLong();

    public AssetCache(Path configDir, boolean keepClientJar) {
        Path base = configDir.resolve("what_guys_doing");
        this.root = base.resolve("assets");
        this.jarsDir = root.resolve(".cache");
        this.contentDir = root.resolve("content");
        this.packsDir = base.resolve("resourcepacks");
        this.keepClientJar = keepClientJar;
    }

    public Path contentDir() {
        return contentDir;
    }

    public Path packsDir() {
        return packsDir;
    }

    public long servedRequests() {
        return servedRequests.get();
    }

    public long servedBytes() {
        return servedBytes.get();
    }

    public void start() {
        Thread thread = new Thread(this::run, "wgd-assets");
        thread.setDaemon(true);
        thread.start();
    }

    private void run() {
        startedAtMillis = System.currentTimeMillis();
        try {
            Files.createDirectories(contentDir);
            Files.createDirectories(packsDir);
            Path marker = root.resolve("ready.marker");
            if (hasContent() && readMarkerFormat(marker) == CACHE_FORMAT) {
                packCount = scanPacks(false);
                state = State.READY;
                finishedAtMillis = System.currentTimeMillis();
                message = "cache hit";
                LOGGER.info("asset cache hit: {} ({} files)", contentDir, entryCount);
                return;
            }

            state = State.MANIFEST;
            message = "reading version manifest";
            String clientUrl = resolveClientUrl(resolveVersionUrl(MINECRAFT_VERSION));

            state = State.DOWNLOADING;
            message = "downloading client jar";
            Path jar = jarsDir.resolve("client-" + MINECRAFT_VERSION + ".jar");
            Files.createDirectories(jarsDir);
            LOGGER.info("fetching vanilla assets: {}", clientUrl);
            download(clientUrl, jar);

            state = State.EXTRACTING;
            message = "extracting blockstates/models/textures/colormaps";
            entryCount = extract(jar);
            // 实体贴图：从 ENTITY_VERSION 的 client jar 里单独抽（覆盖 1.21.1 的同名文件）。
            // 与模型同版本是必须的 —— 贴图布局在不同版本间改过，混用会造成 UV 错位。
            if (!ENTITY_VERSION.equals(MINECRAFT_VERSION)) {
                try {
                    message = "extracting entity textures from " + ENTITY_VERSION;
                    String entityClientUrl = resolveClientUrl(resolveVersionUrl(ENTITY_VERSION));
                    Path entityJar = jarsDir.resolve("client-" + ENTITY_VERSION + ".jar");
                    download(entityClientUrl, entityJar);
                    int entityFiles = extractOnly(entityJar, "minecraft/textures/entity/");
                    entryCount += entityFiles;
                    if (!keepClientJar) {
                        Files.deleteIfExists(entityJar);
                    }
                    LOGGER.info("extracted {} entity textures from {}", entityFiles, ENTITY_VERSION);
                } catch (Exception e) {
                    // 实体贴图失败不影响方块：方块链路仍可用，实体显示为洋红哨兵格。
                    LOGGER.warn("entity textures from {} failed: {}", ENTITY_VERSION, e.toString());
                }
            }
            packCount = scanPacks(true);
            if (!keepClientJar) {
                Files.deleteIfExists(jar);
            }
            Files.writeString(marker, "format=" + CACHE_FORMAT + System.lineSeparator()
                    + "version=" + MINECRAFT_VERSION + System.lineSeparator()
                    + "entries=" + entryCount + System.lineSeparator());
            state = State.READY;
            finishedAtMillis = System.currentTimeMillis();
            message = "ready";
            LOGGER.info("extracted {} files -> {} ({} ms)", entryCount, contentDir, finishedAtMillis - startedAtMillis);
        } catch (Exception e) {
            state = State.FAILED;
            finishedAtMillis = System.currentTimeMillis();
            message = e.getClass().getSimpleName() + ": " + e.getMessage();
            LOGGER.warn("asset fetch failed (browser falls back to block colors): {}", message, e);
        }
    }

    /** 读取缓存标记里的格式版本；缺失或不可读时返回 -1（触发重新抽取）。 */
    private int readMarkerFormat(Path marker) {
        if (!Files.isRegularFile(marker)) {
            return -1;
        }
        try {
            for (String line : Files.readAllLines(marker)) {
                if (line.startsWith("format=")) {
                    return Integer.parseInt(line.substring("format=".length()).trim());
                }
            }
        } catch (Exception e) {
            LOGGER.debug("failed to read cache marker: {}", e.getMessage());
        }
        return -1;
    }

    private boolean hasContent() {
        try (Stream<Path> stream = Files.walk(contentDir, 4)) {
            entryCount = (int) stream.filter(Files::isRegularFile).count();
            return entryCount > 0;
        } catch (IOException e) {
            return false;
        }
    }

    private String resolveVersionUrl(String version) throws IOException {
        JsonObject manifest = fetchJson(VERSION_MANIFEST);
        for (var element : manifest.getAsJsonArray("versions")) {
            JsonObject entry = element.getAsJsonObject();
            if (version.equals(entry.get("id").getAsString())) {
                return entry.get("url").getAsString();
            }
        }
        throw new IOException("版本清单里找不到 " + version);
    }

    private String resolveClientUrl(String versionUrl) throws IOException {
        JsonObject downloads = fetchJson(versionUrl).getAsJsonObject("downloads");
        if (downloads == null || !downloads.has("client")) {
            throw new IOException("该版本没有 client 下载项");
        }
        JsonObject client = downloads.getAsJsonObject("client");
        totalBytes = client.has("size") ? client.get("size").getAsLong() : 0L;
        return client.get("url").getAsString();
    }

    private HttpClient httpClient() {
        return HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(30))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    private JsonObject fetchJson(String url) throws IOException {
        try {
            HttpResponse<String> response = httpClient().send(
                    HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(30)).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                throw new IOException("HTTP " + response.statusCode() + " @ " + url);
            }
            return JsonParser.parseString(response.body()).getAsJsonObject();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("被中断", e);
        }
    }

    private void download(String url, Path target) throws IOException {
        try {
            HttpResponse<InputStream> response = httpClient().send(
                    HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofMinutes(10)).GET().build(),
                    HttpResponse.BodyHandlers.ofInputStream());
            if (response.statusCode() / 100 != 2) {
                throw new IOException("HTTP " + response.statusCode() + " @ " + url);
            }
            Path temp = target.resolveSibling(target.getFileName() + ".part");
            try (InputStream in = response.body(); OutputStream out = Files.newOutputStream(temp)) {
                byte[] buffer = new byte[1 << 16];
                int read;
                while ((read = in.read(buffer)) > 0) {
                    out.write(buffer, 0, read);
                    downloadedBytes += read;
                }
            }
            Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("下载被中断", e);
        }
    }

    /** 抽取单个前缀（用于实体贴图这类"来源版本不同"的资源）。 */
    private int extractOnly(Path archive, String onlyPrefix) throws IOException {
        int extracted = 0;
        try (ZipFile zip = new ZipFile(archive.toFile())) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.isDirectory()) {
                    continue;
                }
                String name = entry.getName();
                if (name.startsWith("assets/")) {
                    name = name.substring("assets/".length());
                }
                if (!name.startsWith(onlyPrefix)) {
                    continue;
                }
                Path target = contentDir.resolve(name).normalize();
                if (!target.startsWith(contentDir)) {
                    continue;
                }
                Files.createDirectories(target.getParent());
                try (InputStream in = zip.getInputStream(entry)) {
                    Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
                }
                extracted++;
            }
        }
        return extracted;
    }

    /** 抽取原版 jar 内所需条目；用户资源包会在之后覆盖同名文件。 */
    private int extract(Path archive) throws IOException {
        int extracted = 0;
        try (ZipFile zip = new ZipFile(archive.toFile())) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.isDirectory()) {
                    continue;
                }
                String name = entry.getName();
                if (name.startsWith("assets/")) {
                    name = name.substring("assets/".length());
                }
                if (!isWanted(name)) {
                    continue;
                }
                Path target = contentDir.resolve(name).normalize();
                if (!target.startsWith(contentDir)) {
                    continue;
                }
                Files.createDirectories(target.getParent());
                try (InputStream in = zip.getInputStream(entry)) {
                    Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
                }
                extracted++;
                entryCount = extracted;
            }
        }
        return extracted;
    }

    /** 扫描用户资源包；{@code apply} 为真时把其中所需条目覆盖到缓存里。 */
    private int scanPacks(boolean apply) {
        if (!Files.isDirectory(packsDir)) {
            return 0;
        }
        List<Path> packs = new ArrayList<>();
        try (Stream<Path> stream = Files.list(packsDir)) {
            stream.filter(path -> path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".zip"))
                    .forEach(packs::add);
        } catch (IOException e) {
            LOGGER.debug("failed to scan resource packs: {}", e.getMessage());
        }
        for (Path pack : packs) {
            if (!apply) {
                continue;
            }
            try {
                int n = extract(pack);
                LOGGER.info("applied resource pack {} ({} files)", pack.getFileName(), n);
            } catch (IOException e) {
                LOGGER.warn("failed to apply resource pack {}: {}", pack.getFileName(), e.getMessage());
            }
        }
        return packs.size();
    }

    private static boolean isWanted(String relative) {
        for (String prefix : WANTED_PREFIXES) {
            if (relative.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    private volatile String modelsBundle;

    /**
     * 把抽取出来的 blockstates + models 打成一个 JSON（键形如 {@code blockstates/stone.json}），
     * 让浏览器一次请求拿到全部 —— 这样烘焙器可以保持同步实现。
     */
    public String modelsBundle() {
        String cached = modelsBundle;
        if (cached != null) {
            return cached;
        }
        synchronized (this) {
            if (modelsBundle != null) {
                return modelsBundle;
            }
            StringBuilder sb = new StringBuilder(4 << 20);
            sb.append('{');
            boolean[] first = {true};
            Path minecraft = contentDir.resolve("minecraft");
            appendDirectory(sb, minecraft.resolve("blockstates"), "blockstates", first);
            appendDirectory(sb, minecraft.resolve("models"), "models", first);
            sb.append('}');
            modelsBundle = sb.toString();
            LOGGER.info("models bundle built: {} bytes", modelsBundle.length());
            return modelsBundle;
        }
    }

    private void appendDirectory(StringBuilder sb, Path dir, String prefix, boolean[] first) {
        if (!Files.isDirectory(dir)) {
            return;
        }
        try (Stream<Path> stream = Files.walk(dir)) {
            for (Path file : stream.filter(Files::isRegularFile).toList()) {
                if (!file.getFileName().toString().endsWith(".json")) {
                    continue;
                }
                String relative = prefix + "/" + dir.relativize(file).toString().replace('\\', '/');
                if (!first[0]) {
                    sb.append(',');
                }
                first[0] = false;
                sb.append('"').append(relative).append("\":").append(Files.readString(file));
            }
        } catch (IOException e) {
            LOGGER.warn("failed to build models bundle: {}", e.getMessage());
        }
    }

    /** HTTP 分发：{@code relative} 形如 {@code minecraft/blockstates/stone.json}。 */
    public FileEntry open(String relative) {
        if (relative == null || relative.isEmpty() || relative.contains("..")) {
            return null;
        }
        Path path = contentDir.resolve(relative).normalize();
        if (!path.startsWith(contentDir) || !Files.isRegularFile(path)) {
            return null;
        }
        try {
            long size = Files.size(path);
            if (size > MAX_SERVED_FILE) {
                return null;
            }
            byte[] data = Files.readAllBytes(path);
            String etag = '"' + Long.toHexString(size) + '-' + Long.toHexString(Files.getLastModifiedTime(path).toMillis()) + '"';
            servedRequests.incrementAndGet();
            servedBytes.addAndGet(data.length);
            return new FileEntry(data, etag, StaticAssets.contentType(relative));
        } catch (IOException e) {
            return null;
        }
    }

    public String statusJson() {
        return Json.object()
                .put("state", state.name())
                .put("message", message)
                .put("version", MINECRAFT_VERSION)
                .put("entries", entryCount)
                .put("resourcePacks", packCount)
                .put("downloadedBytes", downloadedBytes)
                .put("totalBytes", totalBytes)
                .put("servedRequests", servedRequests.get())
                .put("servedBytes", servedBytes.get())
                .put("elapsedMillis", (finishedAtMillis == 0 ? System.currentTimeMillis() : finishedAtMillis) - startedAtMillis)
                .put("contentDir", contentDir.toString())
                .put("packsDir", packsDir.toString())
                .end();
    }
}
