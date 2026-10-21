package github.gtouming.what_guys_doing.web;

import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 从 mod jar 内提供静态资源（web 调试查看器）。 */
public final class StaticAssets {
    private static final String ROOT = "/assets/what_guys_doing/web/";
    private static final Map<String, Entry> CACHE = new ConcurrentHashMap<>();

    public record Entry(byte[] data, String etag, String contentType) {
    }

    private StaticAssets() {
    }

    public static Entry get(String name) {
        if (name == null || name.isEmpty() || name.contains("..")) {
            return null;
        }
        return CACHE.computeIfAbsent(name, StaticAssets::load);
    }

    private static Entry load(String name) {
        try (InputStream in = StaticAssets.class.getResourceAsStream(ROOT + name)) {
            if (in == null) {
                return null;
            }
            byte[] data = in.readAllBytes();
            return new Entry(data, etag(data), contentType(name));
        } catch (IOException e) {
            return null;
        }
    }

    private static String etag(byte[] data) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-1").digest(data);
            return '"' + HexFormat.of().formatHex(digest) + '"';
        } catch (NoSuchAlgorithmException e) {
            return '"' + Integer.toHexString(data.length) + '"';
        }
    }

    public static String contentType(String name) {
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1).toLowerCase();
        return switch (ext) {
            case "html" -> "text/html; charset=utf-8";
            case "js", "mjs" -> "text/javascript; charset=utf-8";
            case "css" -> "text/css; charset=utf-8";
            case "json", "mcmeta" -> "application/json; charset=utf-8";
            case "wasm" -> "application/wasm";
            case "png" -> "image/png";
            case "svg" -> "image/svg+xml";
            default -> "application/octet-stream";
        };
    }
}
