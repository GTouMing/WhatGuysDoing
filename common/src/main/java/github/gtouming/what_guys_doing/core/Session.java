package github.gtouming.what_guys_doing.core;

import github.gtouming.what_guys_doing.net.BinaryReader;
import github.gtouming.what_guys_doing.net.EntityDeltaCodec;
import github.gtouming.what_guys_doing.net.Msg;
import github.gtouming.what_guys_doing.net.Protocol;
import github.gtouming.what_guys_doing.web.WebSocketConnection;
import github.gtouming.what_guys_doing.world.TickFrame;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Iterator;

/**
 * 一个浏览器连接。tick 线程只往队列里放不可变消息；本类的线程负责编码与发送。
 * 队列满时优先丢弃最旧的 section 消息（保留最新状态），绝不阻塞 tick 线程。
 */
public final class Session {
    private static final Logger LOGGER = LoggerFactory.getLogger("what_guys_doing/session");

    private final WebSocketConnection ws;
    private final SessionHub hub;
    private final ModConfig config = ModConfig.INSTANCE;
    public final Subscriptions subs = new Subscriptions();

    private final EntityDeltaCodec entityCodec = new EntityDeltaCodec();
    private final ArrayDeque<Object> queue = new ArrayDeque<>();
    private final Object lock = new Object();
    private volatile boolean closed;

    public Session(WebSocketConnection ws, SessionHub hub) {
        this.ws = ws;
        this.hub = hub;
    }

    public void start() {
        Thread thread = new Thread(this::run, "wgd-session");
        thread.setDaemon(true);
        thread.start();
    }

    /** tick 线程调用。message 为 {@code byte[]}（已编码 section）或 {@link TickFrame}。 */
    public void offer(Object message) {
        synchronized (lock) {
            if (closed) {
                return;
            }
            if (queue.size() >= config.maxQueueSize) {
                dropOldest();
            }
            queue.addLast(message);
            hub.metrics().observeQueueDepth(queue.size());
            lock.notifyAll();
        }
    }

    private void dropOldest() {
        Iterator<Object> it = queue.iterator();
        while (it.hasNext()) {
            if (it.next() instanceof byte[]) {
                it.remove();
                hub.metrics().addDropped(1);
                return;
            }
        }
        if (!queue.isEmpty()) {
            queue.removeFirst();
            hub.metrics().addDropped(1);
        }
    }

    private void run() {
        try {
            ws.sendBinary(Protocol.hello(hub.dimensions(), 20, hub.playerTypeId()));
        } catch (IOException e) {
            close();
            return;
        }
        while (!closed) {
            Object message;
            synchronized (lock) {
                while (queue.isEmpty() && !closed) {
                    try {
                        lock.wait(500L);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
                if (closed) {
                    return;
                }
                message = queue.pollFirst();
            }
            try {
                if (message instanceof TickFrame frame) {
                    sendFrame(frame);
                } else if (message instanceof byte[] raw) {
                    ws.sendBinary(raw);
                    hub.metrics().addSent(raw.length);
                }
            } catch (IOException e) {
                LOGGER.debug("session send failed: {}", e.getMessage());
                close();
                return;
            }
        }
    }

    private void sendFrame(TickFrame frame) throws IOException {
        if (!frame.deltas().isEmpty()) {
            byte[] payload = Protocol.blockDeltas(frame.tick(), frame.deltas(), this::deltaAllowed);
            if (payload.length > 5) {
                ws.sendBinary(payload);
                hub.metrics().addSent(payload.length);
            }
        }
        if (frame.tick() % config.entityIntervalTicks == 0) {
            byte[] payload = entityCodec.encode(frame.tick(), frame.entities());
            ws.sendBinary(payload);
            hub.metrics().addSent(payload.length);
        }
        if (frame.tick() % 20 == 0) {
            byte[] payload = Protocol.timeSync(frame.tick(), frame.gameTime());
            ws.sendBinary(payload);
            hub.metrics().addSent(payload.length);
        }
    }

    private boolean deltaAllowed(int dimId, int x, int y, int z) {
        return subs.isSent(Keys.section(dimId, x >> 4, y >> 4, z >> 4));
    }

    /** WebSocket 读取线程调用。 */
    public void onClientMessage(byte[] data) {
        if (data.length == 0) {
            return;
        }
        try {
            BinaryReader r = new BinaryReader(data);
            int type = r.u8();
            switch (type) {
                case Msg.C_SUBSCRIBE -> {
                    int dimId = r.u8();
                    int centerX = r.i32();
                    int centerZ = r.i32();
                    int radius = r.u8();
                    subs.subscribe(dimId, centerX >> 4, centerZ >> 4, radius);
                    entityCodec.reset();
                }
                case Msg.C_PING -> offer(Protocol.pong());
                default -> LOGGER.debug("unknown client message type {}", type);
            }
        } catch (RuntimeException e) {
            LOGGER.debug("bad client message: {}", e.getMessage());
        }
    }

    public void close() {
        closed = true;
        synchronized (lock) {
            queue.clear();
            lock.notifyAll();
        }
        ws.close();
    }
}
