package github.gtouming.what_guys_doing.net;

import java.nio.charset.StandardCharsets;

/** 小端二进制读取器（用于客户端上行消息）。非线程安全。 */
public final class BinaryReader {
    private final byte[] data;
    private int pos;

    public BinaryReader(byte[] data) {
        this.data = data;
    }

    public boolean hasRemaining() {
        return pos < data.length;
    }

    public int u8() {
        return data[pos++] & 0xFF;
    }

    public int u16() {
        int v = (data[pos] & 0xFF) | ((data[pos + 1] & 0xFF) << 8);
        pos += 2;
        return v;
    }

    public int i32() {
        int v = (data[pos] & 0xFF) | ((data[pos + 1] & 0xFF) << 8)
                | ((data[pos + 2] & 0xFF) << 16) | ((data[pos + 3] & 0xFF) << 24);
        pos += 4;
        return v;
    }

    public int varUInt() {
        int value = 0;
        int shift = 0;
        while (true) {
            int b = u8();
            value |= (b & 0x7F) << shift;
            if ((b & 0x80) == 0) {
                return value;
            }
            shift += 7;
            if (shift > 35) {
                throw new IllegalArgumentException("varint too long");
            }
        }
    }

    public String utf() {
        int len = varUInt();
        String s = new String(data, pos, len, StandardCharsets.UTF_8);
        pos += len;
        return s;
    }
}
