package github.gtouming.what_guys_doing.web;

import github.gtouming.what_guys_doing.core.Session;
import github.gtouming.what_guys_doing.core.SessionHub;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;

/** RFC6455 服务端侧实现：帧编解码、控制帧、消息重组。写操作跨线程加锁。 */
public final class WebSocketConnection {
    private static final Logger LOGGER = LoggerFactory.getLogger("what_guys_doing/ws");
    private static final long MAX_MESSAGE_BYTES = 1L << 22;

    private final Socket socket;
    private final InputStream in;
    private final OutputStream out;
    private final Object writeLock = new Object();
    private final SessionHub hub;
    private volatile boolean open = true;

    public WebSocketConnection(Socket socket, InputStream in, OutputStream out, SessionHub hub) {
        this.socket = socket;
        this.in = in;
        this.out = out;
        this.hub = hub;
    }

    public void run() {
        Session session = null;
        try {
            session = hub.addSession(this);
            session.start();
            while (open) {
                byte[] message = readMessage();
                if (message == null) {
                    break;
                }
                session.onClientMessage(message);
            }
        } catch (IOException e) {
            LOGGER.debug("websocket closed: {}", e.getMessage());
        } finally {
            if (session != null) {
                hub.removeSession(session);
            }
            close();
        }
    }

    public void sendBinary(byte[] payload) throws IOException {
        synchronized (writeLock) {
            if (!open) {
                throw new IOException("websocket closed");
            }
            out.write(0x82);
            int len = payload.length;
            if (len < 126) {
                out.write(len);
            } else if (len < 65536) {
                out.write(126);
                out.write((len >>> 8) & 0xFF);
                out.write(len & 0xFF);
            } else {
                out.write(127);
                for (int shift = 56; shift >= 0; shift -= 8) {
                    out.write((int) (((long) len >>> shift) & 0xFF));
                }
            }
            out.write(payload);
            out.flush();
        }
    }

    public void close() {
        synchronized (writeLock) {
            if (open) {
                open = false;
                try {
                    out.write(new byte[]{(byte) 0x88, 0});
                    out.flush();
                } catch (IOException ignored) {
                    // 连接已断，忽略
                }
            }
        }
        try {
            socket.close();
        } catch (IOException ignored) {
            // 连接已断，忽略
        }
    }

    /** 读取一条完整消息（自动处理分片与控制帧）。返回 null 表示连接结束。 */
    private byte[] readMessage() throws IOException {
        ByteArrayOutputStream message = null;
        while (true) {
            int b0 = in.read();
            if (b0 < 0) {
                return null;
            }
            boolean fin = (b0 & 0x80) != 0;
            int opcode = b0 & 0x0F;
            int b1 = in.read();
            if (b1 < 0) {
                return null;
            }
            boolean masked = (b1 & 0x80) != 0;
            long len = b1 & 0x7F;
            if (len == 126) {
                len = ((long) readByte() << 8) | readByte();
            } else if (len == 127) {
                len = 0;
                for (int i = 0; i < 8; i++) {
                    len = (len << 8) | readByte();
                }
            }
            if (len < 0 || len > MAX_MESSAGE_BYTES) {
                throw new IOException("websocket frame too large: " + len);
            }
            byte[] mask = null;
            if (masked) {
                mask = readFully(4);
            }
            byte[] payload = readFully((int) len);
            if (mask != null) {
                for (int i = 0; i < payload.length; i++) {
                    payload[i] ^= mask[i & 3];
                }
            }
            switch (opcode) {
                case 0x8 -> {
                    sendControl(0x8, new byte[0]);
                    return null;
                }
                case 0x9 -> sendControl(0xA, payload);
                case 0xA -> {
                    // pong：无需处理
                }
                case 0x1, 0x2 -> {
                    message = new ByteArrayOutputStream(Math.max(64, payload.length));
                    message.write(payload);
                    if (fin) {
                        return message.toByteArray();
                    }
                }
                case 0x0 -> {
                    if (message == null) {
                        throw new IOException("continuation without start");
                    }
                    message.write(payload);
                    if (fin) {
                        return message.toByteArray();
                    }
                }
                default -> throw new IOException("unsupported websocket opcode " + opcode);
            }
        }
    }

    private void sendControl(int opcode, byte[] payload) throws IOException {
        synchronized (writeLock) {
            if (!open) {
                return;
            }
            out.write(0x80 | opcode);
            out.write(Math.min(payload.length, 125));
            out.write(payload, 0, Math.min(payload.length, 125));
            out.flush();
        }
    }

    private int readByte() throws IOException {
        int b = in.read();
        if (b < 0) {
            throw new IOException("unexpected end of stream");
        }
        return b;
    }

    private byte[] readFully(int len) throws IOException {
        byte[] buf = new byte[len];
        int off = 0;
        while (off < len) {
            int read = in.read(buf, off, len - off);
            if (read < 0) {
                throw new IOException("unexpected end of stream");
            }
            off += read;
        }
        return buf;
    }
}
