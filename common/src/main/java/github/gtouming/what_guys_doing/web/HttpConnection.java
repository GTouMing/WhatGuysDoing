package github.gtouming.what_guys_doing.web;

import github.gtouming.what_guys_doing.core.SessionHub;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/** 单连接处理：HTTP/1.1 静态资源与 /api，或升级为 WebSocket。 */
public final class HttpConnection implements Runnable {
    private static final Logger LOGGER = LoggerFactory.getLogger("what_guys_doing/http");
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int MAX_LINE = 8192;

    private final Socket socket;
    private final SessionHub hub;

    public HttpConnection(Socket socket, SessionHub hub) {
        this.socket = socket;
        this.hub = hub;
    }

    @Override
    public void run() {
        try (socket) {
            InputStream in = new BufferedInputStream(socket.getInputStream(), 8192);
            OutputStream out = new BufferedOutputStream(socket.getOutputStream(), 8192);
            while (true) {
                String requestLine = readLine(in);
                if (requestLine == null) {
                    return;
                }
                if (requestLine.isEmpty()) {
                    continue;
                }
                Map<String, String> headers = readHeaders(in);
                String[] parts = requestLine.split(" ");
                if (parts.length < 3) {
                    return;
                }
                String method = parts[0];
                String path = parts[1];
                if ("websocket".equalsIgnoreCase(headers.getOrDefault("upgrade", ""))) {
                    upgrade(in, out, headers);
                    return;
                }
                if (!handleHttp(method, path, headers, out)) {
                    return;
                }
            }
        } catch (IOException e) {
            LOGGER.debug("http connection closed: {}", e.getMessage());
        }
    }

    private void upgrade(InputStream in, OutputStream out, Map<String, String> headers) throws IOException {
        String key = headers.get("sec-websocket-key");
        if (key == null) {
            respond(out, 400, "Bad Request", "text/plain; charset=utf-8", "missing Sec-WebSocket-Key".getBytes(StandardCharsets.UTF_8), null, false);
            return;
        }
        String accept;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-1").digest((key + WS_GUID).getBytes(StandardCharsets.US_ASCII));
            accept = Base64.getEncoder().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) {
            return;
        }
        String response = "HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
        out.write(response.getBytes(StandardCharsets.US_ASCII));
        out.flush();
        new WebSocketConnection(socket, in, out, hub).run();
    }

    /** @return false 表示需要关闭连接 */
    private boolean handleHttp(String method, String path, Map<String, String> headers, OutputStream out) throws IOException {
        boolean keepAlive = !"close".equalsIgnoreCase(headers.getOrDefault("connection", "keep-alive"));
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            respond(out, 405, "Method Not Allowed", "text/plain; charset=utf-8", "GET only".getBytes(StandardCharsets.UTF_8), null, keepAlive);
            return keepAlive;
        }
        String queryString = null;
        int query = path.indexOf('?');
        if (query >= 0) {
            queryString = path.substring(query + 1);
            path = path.substring(0, query);
        }
        if ("/api/entity-types".equals(path)) {
            byte[] body = hub.entityTypeLines(queryParam(queryString, "ids")).getBytes(StandardCharsets.UTF_8);
            respond(out, 200, "OK", "text/plain; charset=utf-8", body, null, keepAlive);
            return keepAlive;
        }
        if ("/api/entity-bundle".equals(path)) {
            // 预生成的实体模型 + entitystates（tools/build-entity-bundle.mjs 产出，打进 jar）
            byte[] body = entityBundle();
            if (body == null) {
                respond(out, 503, "Service Unavailable", "text/plain; charset=utf-8",
                        "entity bundle missing from jar".getBytes(StandardCharsets.UTF_8), null, keepAlive);
                return keepAlive;
            }
            respond(out, 200, "OK", "application/json; charset=utf-8", body, entityBundleEtag(), keepAlive);
            return keepAlive;
        }
        if ("/api/blockstates".equals(path)) {
            byte[] body = hub.blockStateLines(queryParam(queryString, "ids")).getBytes(StandardCharsets.UTF_8);
            respond(out, 200, "OK", "text/plain; charset=utf-8", body, null, keepAlive);
            return keepAlive;
        }
        if ("/health".equals(path)) {
            // 极简存活探针：脚本/工具等待服务就绪时用它，不必解析 JSON
            respond(out, 200, "OK", "text/plain; charset=utf-8", "ok".getBytes(StandardCharsets.UTF_8), null, keepAlive);
            return keepAlive;
        }
        if ("/api/status".equals(path)) {
            byte[] body = hub.statusJson().getBytes(StandardCharsets.UTF_8);
            respond(out, 200, "OK", "application/json; charset=utf-8", body, null, keepAlive);
            return keepAlive;
        }
        if ("/api/assets/status".equals(path)) {
            byte[] body = hub.assetStatusJson().getBytes(StandardCharsets.UTF_8);
            respond(out, 200, "OK", "application/json; charset=utf-8", body, null, keepAlive);
            return keepAlive;
        }
        if ("/api/models-bundle".equals(path)) {
            AssetCache cache = hub.assets();
            if (cache == null) {
                respond(out, 404, "Not Found", "text/plain; charset=utf-8", "assets disabled".getBytes(StandardCharsets.UTF_8), null, keepAlive);
                return keepAlive;
            }
            byte[] body = cache.modelsBundle().getBytes(StandardCharsets.UTF_8);
            respond(out, 200, "OK", "application/json; charset=utf-8", body, null, keepAlive);
            return keepAlive;
        }
        if (path.startsWith("/assets/skins/") && path.endsWith(".png")) {
            String uuid = path.substring("/assets/skins/".length(), path.length() - ".png".length());
            AssetCache cache = hub.assets();
            byte[] fallback = null;
            java.nio.file.Path skinDir = null;
            if (cache != null) {
                java.nio.file.Path content = cache.contentDir();
                java.nio.file.Path defaultFile = content.resolve(
                        "minecraft/textures/entity/player/wide/steve.png");
                try {
                    if (java.nio.file.Files.isRegularFile(defaultFile)) {
                        fallback = java.nio.file.Files.readAllBytes(defaultFile);
                    }
                } catch (Exception ignored) {
                }
                skinDir = content.getParent().resolve("skins");
            }
            SkinCache.Skin skin = SkinCache.get(uuid, fallback, skinDir);
            if (skin.bytes() == null) {
                respond(out, 404, "Not Found", "text/plain; charset=utf-8",
                        "player skin unavailable".getBytes(StandardCharsets.UTF_8), null, keepAlive);
                return keepAlive;
            }
            byte[] body = "HEAD".equals(method) ? new byte[0] : skin.bytes();
            String head = "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: " + body.length
                    + "\r\nX-Skin-Model: " + skin.model()
                    + "\r\nConnection: " + (keepAlive ? "keep-alive" : "close") + "\r\n\r\n";
            out.write(head.getBytes(StandardCharsets.US_ASCII));
            out.write(body);
            out.flush();
            return keepAlive;
        }
        if (path.startsWith("/assets/capes/") && path.endsWith(".png")) {
            String uuid = path.substring("/assets/capes/".length(), path.length() - ".png".length());
            AssetCache cache = hub.assets();
            java.nio.file.Path skinDir = null;
            if (cache != null) {
                skinDir = cache.contentDir().getParent().resolve("skins");
            }
            SkinCache.Skin skin = SkinCache.get(uuid, null, skinDir);
            byte[] cape = skin.cape();
            if (cape == null) {
                respond(out, 404, "Not Found", "text/plain; charset=utf-8",
                        "player cape unavailable".getBytes(StandardCharsets.UTF_8), null, keepAlive);
                return keepAlive;
            }
            byte[] body = "HEAD".equals(method) ? new byte[0] : cape;
            String head = "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: " + body.length
                    + "\r\nConnection: " + (keepAlive ? "keep-alive" : "close") + "\r\n\r\n";
            out.write(head.getBytes(StandardCharsets.US_ASCII));
            out.write(body);
            out.flush();
            return keepAlive;
        }
        if (path.startsWith("/assets/")) {
            AssetCache cache = hub.assets();
            AssetCache.FileEntry entry = cache == null ? null : cache.open(path.substring("/assets/".length()));
            if (entry == null) {
                respond(out, 404, "Not Found", "text/plain; charset=utf-8", "asset not found".getBytes(StandardCharsets.UTF_8), null, keepAlive);
                return keepAlive;
            }
            String ifNoneMatchAsset = headers.get("if-none-match");
            if (ifNoneMatchAsset != null && ifNoneMatchAsset.equals(entry.etag())) {
                out.write(("HTTP/1.1 304 Not Modified\r\nETag: " + entry.etag()
                        + "\r\nConnection: " + (keepAlive ? "keep-alive" : "close") + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                out.flush();
                return keepAlive;
            }
            byte[] assetBody = "HEAD".equals(method) ? new byte[0] : entry.data();
            respond(out, 200, "OK", entry.contentType(), assetBody, entry.etag(), keepAlive);
            return keepAlive;
        }
        if ("/api/hello".equals(path)) {
            byte[] body = hub.helloJson().getBytes(StandardCharsets.UTF_8);
            respond(out, 200, "OK", "application/json; charset=utf-8", body, null, keepAlive);
            return keepAlive;
        }
        String assetName = "/".equals(path) ? "index.html" : path.substring(1);
        StaticAssets.Entry entry = StaticAssets.get(assetName);
        if (entry == null) {
            respond(out, 404, "Not Found", "text/plain; charset=utf-8", "not found".getBytes(StandardCharsets.UTF_8), null, keepAlive);
            return keepAlive;
        }
        String ifNoneMatch = headers.get("if-none-match");
        if (ifNoneMatch != null && ifNoneMatch.equals(entry.etag())) {
            String head = "HTTP/1.1 304 Not Modified\r\n"
                    + "ETag: " + entry.etag() + "\r\n"
                    + "Connection: " + (keepAlive ? "keep-alive" : "close") + "\r\n\r\n";
            out.write(head.getBytes(StandardCharsets.US_ASCII));
            out.flush();
            return keepAlive;
        }
        byte[] body = "HEAD".equals(method) ? new byte[0] : entry.data();
        respond(out, 200, "OK", entry.contentType(), body, entry.etag(), keepAlive);
        return keepAlive;
    }

    private void respond(OutputStream out, int code, String status, String contentType, byte[] body, String etag, boolean keepAlive) throws IOException {
        StringBuilder head = new StringBuilder(160);
        head.append("HTTP/1.1 ").append(code).append(' ').append(status).append("\r\n");
        head.append("Content-Type: ").append(contentType).append("\r\n");
        head.append("Content-Length: ").append(body.length).append("\r\n");
        // 代码与 HTML 绝不缓存：max-age 会让浏览器连源都不回，于是"改了代码页面依旧是旧模块"
        // （踩过的坑：修了 baker/mesher 的 UV，浏览器还在跑旧 JS，看起来像是没修）。
        // 贴图/模型等资源仍按 ETag 缓存 —— 同一版本内容不变，省下上千次请求。
        boolean neverCache = contentType.startsWith("text/javascript")
                || contentType.startsWith("text/html")
                || contentType.startsWith("application/json");
        if (etag != null && !neverCache) {
            head.append("ETag: ").append(etag).append("\r\n");
            head.append("Cache-Control: public, max-age=300\r\n");
        } else {
            head.append("Cache-Control: no-store\r\n");
        }
        head.append("Connection: ").append(keepAlive ? "keep-alive" : "close").append("\r\n\r\n");
        out.write(head.toString().getBytes(StandardCharsets.US_ASCII));
        if (body.length > 0) {
            out.write(body);
        }
        out.flush();
    }

    /** 取 URL 查询参数（最小解码，够 ids 这类数字列表用）。 */
    /** 实体 bundle 是 jar 内的静态资源，只在首次请求时读取一次。 */
    private static volatile byte[] ENTITY_BUNDLE;
    private static volatile String ENTITY_BUNDLE_ETAG;

    private static byte[] entityBundle() {
        byte[] cached = ENTITY_BUNDLE;
        if (cached != null) {
            return cached;
        }
        try (InputStream in = HttpConnection.class.getResourceAsStream("/assets/what_guys_doing/entitybundle.json")) {
            if (in == null) {
                LOGGER.warn("entity bundle resource missing from jar");
                return null;
            }
            byte[] data = in.readAllBytes();
            ENTITY_BUNDLE_ETAG = '"' + Integer.toHexString(java.util.Arrays.hashCode(data)) + '-' + data.length + '"';
            ENTITY_BUNDLE = data;
            return data;
        } catch (IOException e) {
            LOGGER.warn("failed to read entity bundle: {}", e.toString());
            return null;
        }
    }

    private static String entityBundleEtag() {
        entityBundle();
        return ENTITY_BUNDLE_ETAG;
    }

    private static String queryParam(String query, String key) {
        if (query == null) {
            return null;
        }
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && pair.substring(0, eq).equals(key)) {
                return java.net.URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
            }
        }
        return null;
    }

    private Map<String, String> readHeaders(InputStream in) throws IOException {
        Map<String, String> headers = new HashMap<>();
        String line;
        while ((line = readLine(in)) != null && !line.isEmpty()) {
            int colon = line.indexOf(':');
            if (colon > 0) {
                headers.put(line.substring(0, colon).trim().toLowerCase(), line.substring(colon + 1).trim());
            }
        }
        return headers;
    }

    private String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream(96);
        int b;
        while ((b = in.read()) >= 0) {
            if (b == '\n') {
                break;
            }
            if (b != '\r') {
                buf.write(b);
            }
            if (buf.size() > MAX_LINE) {
                throw new IOException("header line too long");
            }
        }
        if (b < 0 && buf.size() == 0) {
            return null;
        }
        return buf.toString(StandardCharsets.ISO_8859_1);
    }
}
