import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/** JDK-only capability probe; not observation or authorization implementation. */
public final class V1bStartupProbe {
    private static final Path RUN = Path.of("E:/Projects/WhatGuysDoing/verification/observation-stage1/v1b-20261111-095001");
    private static final byte[] EXPECTED_READY = "V1B_STARTUP_READY\n".getBytes(StandardCharsets.US_ASCII);

    public static void main(String[] args) throws Exception {
        requireRunDirectory();
        if (args.length == 1 && args[0].equals("startup-worker")) {
            System.out.write("V1B_STARTUP_READY\n".getBytes(StandardCharsets.US_ASCII));
            System.out.flush();
            return;
        }
        if (args.length != 1 || !args[0].equals("startup-gate")) {
            throw new IllegalArgumentException("Only the approved startup gate is available");
        }
        verifyStartup();
        System.out.println("PASS caller receives the complete startup marker and normal exit");
    }

    private static void verifyStartup() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(40);
        Path caseRoot = Files.createDirectory(RUN.resolve("fixtures/startup-gate"));
        Path stderr = Files.createFile(caseRoot.resolve("worker-stderr.bin"));
        Process worker = null;
        Throwable primaryFailure = null;
        boolean ioAttempted = false;
        byte[] actual = null;
        int exit = -1;
        try {
            worker = new ProcessBuilder(
                    "E:/Java/21/bin/java.exe", "-Xms16m", "-Xmx128m", "-XX:-UsePerfData",
                    "-Djava.io.tmpdir=" + RUN.resolve("tmp"), "-Duser.home=" + RUN.resolve("tmp"),
                    "-XX:ErrorFile=" + RUN.resolve("logs/worker_hs_err_pid%p.log"),
                    "-cp", RUN.resolve("classes").toString(), "V1bStartupProbe", "startup-worker")
                    .directory(RUN.toFile())
                    .redirectInput(ProcessBuilder.Redirect.PIPE)
                    .redirectOutput(ProcessBuilder.Redirect.PIPE)
                    .redirectError(stderr.toFile())
                    .start();
            System.out.println("OWNED_WORKER_STARTED pid=" + worker.pid());
            if (!worker.waitFor(remaining(deadline, 10), TimeUnit.NANOSECONDS)) {
                throw new AssertionError("Startup worker did not exit within its wait budget");
            }
            exit = worker.exitValue();
            System.out.println("OWNED_WORKER_EXIT_CONFIRMED exit=" + exit);
            ioAttempted = true;
            actual = postExitIo(worker, deadline);
        } catch (Exception | Error failure) {
            primaryFailure = failure;
            throw failure;
        } finally {
            if (worker != null) {
                try {
                    if (worker.isAlive()) {
                        System.out.println("OWNED_WORKER_TERMINATION_REQUESTED pid=" + worker.pid());
                        worker.destroyForcibly();
                        if (!worker.waitFor(remaining(deadline, 5), TimeUnit.NANOSECONDS)) {
                            throw new IOException("Owned worker termination could not be confirmed; stop the batch");
                        }
                        System.out.println("OWNED_WORKER_CLEANUP_EXIT_CONFIRMED exit=" + worker.exitValue());
                    }
                    if (!ioAttempted) {
                        postExitIo(worker, deadline);
                    }
                } catch (Exception | Error cleanupFailure) {
                    System.err.println("OWNED_WORKER_CLEANUP_FAILED " + cleanupFailure.getClass().getName());
                    if (primaryFailure == null) {
                        throw cleanupFailure;
                    }
                    primaryFailure.addSuppressed(cleanupFailure);
                }
            }
        }
        if (exit != 0 || !Arrays.equals(EXPECTED_READY, actual)) {
            throw new AssertionError("Startup requires exact fixed ASCII bytes and normal exit; exit=" + exit);
        }
    }

    private static byte[] postExitIo(Process worker, long deadline) throws Exception {
        if (worker.isAlive()) {
            throw new IllegalStateException("Do not close a reader before the owned worker exits");
        }
        ExecutorService io = Executors.newSingleThreadExecutor(
                Thread.ofPlatform().daemon(true).name("v1b-post-exit-io").factory());
        Future<byte[]> result = io.submit(() -> {
            try (InputStream stdout = worker.getInputStream();
                 OutputStream stdin = worker.getOutputStream();
                 InputStream stderr = worker.getErrorStream()) {
                return stdout.readNBytes(EXPECTED_READY.length + 1);
            }
        });
        try {
            return result.get(remaining(deadline, 1), TimeUnit.NANOSECONDS);
        } finally {
            result.cancel(true);
            io.shutdownNow();
        }
    }

    private static long remaining(long deadline, int maxSeconds) {
        long nanos = deadline - System.nanoTime();
        if (nanos <= 0) {
            throw new IllegalStateException("The original monotonic task deadline expired");
        }
        return Math.min(nanos, TimeUnit.SECONDS.toNanos(maxSeconds));
    }

    private static void requireRunDirectory() throws IOException {
        if (!RUN.toRealPath().equals(RUN.toAbsolutePath().normalize()) || Files.isSymbolicLink(RUN)) {
            throw new IOException("Unsafe approved run root");
        }
        for (String name : new String[] {"src", "classes", "fixtures", "tmp", "logs", "evidence"}) {
            Path directory = RUN.resolve(name);
            if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)
                    || !directory.toRealPath().equals(directory)) {
                throw new IOException("Unsafe approved run subdirectory: " + name);
            }
        }
    }
}
