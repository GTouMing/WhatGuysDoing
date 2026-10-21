package github.gtouming.what_guys_doing.web;

/** 极简 JSON 对象构造器（只支持一层扁平对象，够 /api/status 用）。 */
public final class Json {
    private final StringBuilder sb = new StringBuilder(256);
    private boolean first = true;

    private Json() {
        sb.append('{');
    }

    public static Json object() {
        return new Json();
    }

    public Json put(String key, long value) {
        key(key);
        sb.append(value);
        return this;
    }

    public Json put(String key, double value) {
        key(key);
        sb.append(value);
        return this;
    }

    public Json put(String key, String value) {
        key(key);
        sb.append('"');
        escape(value);
        sb.append('"');
        return this;
    }

    public String end() {
        return sb.append('}').toString();
    }

    private void key(String key) {
        if (!first) {
            sb.append(',');
        }
        first = false;
        sb.append('"');
        escape(key);
        sb.append("\":");
    }

    private void escape(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
    }
}
