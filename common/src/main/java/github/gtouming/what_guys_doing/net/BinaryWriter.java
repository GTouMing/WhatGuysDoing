package github.gtouming.what_guys_doing.net;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** 小端、可增长的二进制写入器。仅服务器线程或单连接线程使用，非线程安全。 */
public final class BinaryWriter {
    private byte[] buf;
    private int len;

    public BinaryWriter(int initialCapacity) {
        this.buf = new byte[Math.max(16, initialCapacity)];
    }

    public int size() {
        return len;
    }

    private void ensure(int extra) {
        if (len + extra > buf.length) {
            int cap = buf.length;
            while (cap < len + extra) {
                cap <<= 1;
            }
            buf = Arrays.copyOf(buf, cap);
        }
    }

    public BinaryWriter u8(int v) {
        ensure(1);
        buf[len++] = (byte) v;
        return this;
    }

    public BinaryWriter u16(int v) {
        ensure(2);
        buf[len++] = (byte) v;
        buf[len++] = (byte) (v >>> 8);
        return this;
    }

    public BinaryWriter i16(int v) {
        return u16(v & 0xFFFF);
    }

    public BinaryWriter i32(int v) {
        ensure(4);
        buf[len++] = (byte) v;
        buf[len++] = (byte) (v >>> 8);
        buf[len++] = (byte) (v >>> 16);
        buf[len++] = (byte) (v >>> 24);
        return this;
    }

    public BinaryWriter u32(long v) {
        return i32((int) v);
    }

    public BinaryWriter u64(long v) {
        i32((int) v);
        i32((int) (v >>> 32));
        return this;
    }

    public BinaryWriter varUInt(int value) {
        int v = value;
        while ((v & ~0x7F) != 0) {
            u8((v & 0x7F) | 0x80);
            v >>>= 7;
        }
        return u8(v);
    }

    public BinaryWriter utf(String s) {
        byte[] b = s.getBytes(StandardCharsets.UTF_8);
        varUInt(b.length);
        return bytes(b);
    }

    public BinaryWriter bytes(byte[] b) {
        ensure(b.length);
        System.arraycopy(b, 0, buf, len, b.length);
        len += b.length;
        return this;
    }

    /** 以 1/scale 精度写入浮点（四舍五入）。 */
    public BinaryWriter fixed(double value, int scale) {
        return i32((int) Math.round(value * scale));
    }

    /** 角度写入 u16 满圈表示。 */
    public BinaryWriter angle(float degrees) {
        int v = Math.round(degrees * (65536.0f / 360.0f)) & 0xFFFF;
        return u16(v);
    }

    public byte[] toBytes() {
        return Arrays.copyOf(buf, len);
    }
}
