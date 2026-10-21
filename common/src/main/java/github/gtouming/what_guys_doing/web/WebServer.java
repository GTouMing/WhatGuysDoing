package github.gtouming.what_guys_doing.web;

import github.gtouming.what_guys_doing.core.SessionHub;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 单个端口上的内嵌服务：接受连接并交给 {@link HttpConnection}。 */
public final class WebServer {
    private static final Logger LOGGER = LoggerFactory.getLogger("what_guys_doing/web");

    private final ServerSocket socket;
    private final SessionHub hub;
    private final ExecutorService workers;
    private Thread acceptThread;

    public WebServer(int port, SessionHub hub) throws IOException {
        this.hub = hub;
        this.socket = new ServerSocket();
        this.socket.setReuseAddress(true);
        this.socket.bind(new InetSocketAddress(port));
        this.workers = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "wgd-web");
            t.setDaemon(true);
            return t;
        });
    }

    public int port() {
        return socket.getLocalPort();
    }

    public void start() {
        acceptThread = new Thread(this::acceptLoop, "wgd-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    private void acceptLoop() {
        while (!socket.isClosed()) {
            try {
                Socket client = socket.accept();
                client.setTcpNoDelay(true);
                workers.execute(new HttpConnection(client, hub));
            } catch (IOException e) {
                if (!socket.isClosed()) {
                    LOGGER.warn("accept failed: {}", e.getMessage());
                }
                return;
            }
        }
    }

    public void stop() {
        try {
            socket.close();
        } catch (IOException ignored) {
            // 忽略
        }
        workers.shutdownNow();
    }

    /** 尽力找出一张局域网地址，仅用于日志提示。 */
    public static String describeLanAddress(int port) {
        try {
            for (NetworkInterface nic : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nic.isUp() || nic.isLoopback() || nic.isVirtual()) {
                    continue;
                }
                for (InetAddress address : Collections.list(nic.getInetAddresses())) {
                    if (address instanceof Inet4Address && !address.isLoopbackAddress() && address.isSiteLocalAddress()) {
                        return "http://" + address.getHostAddress() + ":" + port + "/";
                    }
                }
            }
        } catch (Exception ignored) {
            // 忽略
        }
        return "http://<your-lan-ip>:" + port + "/";
    }
}
