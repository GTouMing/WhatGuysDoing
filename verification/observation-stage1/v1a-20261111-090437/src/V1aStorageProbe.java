import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.nio.file.StandardOpenOption;
import java.nio.file.StandardCopyOption;
import java.nio.channels.FileChannel;
import java.nio.ByteBuffer;
import java.util.Arrays;

/** Isolated probe of JDK file primitives, not a production authorization store. */
public final class V1aStorageProbe {
    private static final Path RUN = Path.of("E:/Projects/WhatGuysDoing/verification/observation-stage1/v1a-20261111-090437");
    private static final byte[] OLD = "{\"fixture\":\"synthetic-only\",\"revision\":1,\"status\":\"old\"}\n".getBytes(StandardCharsets.UTF_8);
    private static final byte[] NEW = "{\"fixture\":\"synthetic-only\",\"revision\":2,\"status\":\"new\"}\n".getBytes(StandardCharsets.UTF_8);

    public static void main(String[] args) throws Exception {
        if (args.length == 2 && args[0].equals("owned-worker") && args[1].equals("interrupt-partial")) {
            ownedPartialWriter();
            return;
        }
        if (args.length != 1) {
            throw new IllegalArgumentException("One isolated test mode is required");
        }
        if (args[0].equals("interrupt-partial")) {
            interruptPartial();
            return;
        }
        if (args[0].equals("read-boundaries")) {
            readBoundaries();
            return;
        }
        if (args[0].equals("write-boundaries")) {
            Path caseRoot = newCase("write-boundaries");
            Path current = caseRoot.resolve("current.json");
            Files.write(current, OLD, StandardOpenOption.CREATE_NEW);
            try (FileChannel readOnly = FileChannel.open(current, StandardOpenOption.READ)) {
                try {
                    readOnly.write(ByteBuffer.wrap(NEW));
                    throw new AssertionError("Read-only channel accepted a write");
                } catch (java.nio.channels.NonWritableChannelException expected) {
                    assertBytes(OLD, Files.readAllBytes(current), "failed channel write leaves current file intact");
                    System.out.println("PASS NonWritableChannelException leaves current synthetic bytes unchanged");
                }
            }
            Path pending = caseRoot.resolve("pending.json");
            Files.write(pending, NEW, StandardOpenOption.CREATE_NEW);
            Path occupied = Files.createDirectory(caseRoot.resolve("occupied-target"));
            Files.writeString(occupied.resolve("owned-marker.txt"), "synthetic-only", StandardOpenOption.CREATE_NEW);
            try {
                Files.move(pending, occupied, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                throw new AssertionError("Atomic replacement unexpectedly removed a non-empty directory");
            } catch (java.nio.file.FileSystemException expected) {
                assertBytes(OLD, Files.readAllBytes(current), "failed move does not alter current bytes");
                assertBytes(NEW, Files.readAllBytes(pending), "failed move leaves pending bytes available");
                System.out.println("PASS failed atomic move raises " + expected.getClass().getSimpleName() + "; no fallback or promotion");
            }
            return;
        }
        if (!(args[0].equals("replacement-red") || args[0].equals("replacement-green"))) {
            throw new IllegalArgumentException("Unsupported isolated test mode");
        }
        Path caseRoot = newCase(args[0]);
        Path current = caseRoot.resolve("current.json");
        Files.write(current, OLD, StandardOpenOption.CREATE_NEW);
        if (args[0].equals("replacement-green")) {
            Path pending = caseRoot.resolve("pending.json");
            try (FileChannel writer = FileChannel.open(pending, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                ByteBuffer bytes = ByteBuffer.wrap(NEW);
                while (bytes.hasRemaining()) {
                    writer.write(bytes);
                }
                writer.force(true);
            }
            Files.move(pending, current, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        }
        assertBytes(NEW, Files.readAllBytes(current), "caller reads the newly submitted synthetic JSON");
        System.out.println("PASS caller reads complete replacement bytes after force and atomic move");
    }

    private static void ownedPartialWriter() throws Exception {
        Path caseRoot = RUN.resolve("fixtures/interrupt-partial").toRealPath();
        if (!caseRoot.equals(RUN.resolve("fixtures/interrupt-partial"))) {
            throw new IllegalStateException("Unsafe owned worker directory");
        }
        Path pending = caseRoot.resolve("pending.json");
        byte[] partial = "{\"fixture\":\"synthetic-only\",".getBytes(StandardCharsets.UTF_8);
        try (FileChannel writer = FileChannel.open(pending, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            ByteBuffer bytes = ByteBuffer.wrap(partial);
            while (bytes.hasRemaining()) {
                writer.write(bytes);
            }
            writer.force(true);
            System.out.println("OWNED_PARTIAL_READY");
            System.out.flush();
            if (System.in.read() != -1) {
                throw new IllegalStateException("Worker must only be terminated, not resumed");
            }
        }
    }

    private static void interruptPartial() throws Exception {
        Path caseRoot = newCase("interrupt-partial");
        Path current = caseRoot.resolve("current.json");
        Files.write(current, OLD, StandardOpenOption.CREATE_NEW);
        Process worker = new ProcessBuilder(
                "E:/Java/21/bin/java.exe", "-Xms16m", "-Xmx128m", "-XX:-UsePerfData",
                "-Djava.io.tmpdir=" + RUN.resolve("tmp"), "-Duser.home=" + RUN.resolve("tmp"),
                "-XX:ErrorFile=" + RUN.resolve("logs/hs_err_pid%p.log"),
                "-cp", RUN.resolve("classes").toString(), "V1aStorageProbe", "owned-worker", "interrupt-partial")
                .directory(RUN.toFile())
                .redirectError(caseRoot.resolve("worker-stderr.txt").toFile())
                .start();
        try (java.io.BufferedReader output = worker.inputReader(StandardCharsets.UTF_8)) {
            java.util.concurrent.CompletableFuture<String> marker = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
                try {
                    return output.readLine();
                } catch (java.io.IOException failure) {
                    throw new java.io.UncheckedIOException(failure);
                }
            });
            String ready = marker.get(10, java.util.concurrent.TimeUnit.SECONDS);
            if (!"OWNED_PARTIAL_READY".equals(ready) || !worker.isAlive()) {
                throw new AssertionError("Owned writer did not reach the intended interruption point");
            }
            worker.destroyForcibly();
            if (!worker.waitFor(10, java.util.concurrent.TimeUnit.SECONDS)) {
                throw new AssertionError("Owned writer did not terminate within its budget");
            }
            assertBytes(OLD, Files.readAllBytes(current), "partial pending write never replaces current bytes");
            byte[] expectedPartial = "{\"fixture\":\"synthetic-only\",".getBytes(StandardCharsets.UTF_8);
            assertBytes(expectedPartial, Files.readAllBytes(caseRoot.resolve("pending.json")), "partial pending bytes remain identifiable");
            System.out.println("PASS owned writer terminated before replacement; old current bytes retained, partial temp retained; workerExit=" + worker.exitValue());
        } finally {
            if (worker.isAlive()) {
                worker.destroyForcibly();
                if (!worker.waitFor(10, java.util.concurrent.TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Owned worker cleanup failed; stop the run");
                }
            }
            worker.getOutputStream().close();
        }
    }

    private static void readBoundaries() throws Exception {
        Path caseRoot = newCase("read-boundaries");
        try {
            Files.readAllBytes(caseRoot.resolve("missing.json"));
            throw new AssertionError("Missing synthetic file was treated as readable");
        } catch (java.nio.file.NoSuchFileException expected) {
            System.out.println("PASS missing synthetic file raises NoSuchFileException");
        }
        byte[] truncated = "{\"fixture\":\"synthetic-only\",\"revision\":".getBytes(StandardCharsets.UTF_8);
        Path truncatedFile = caseRoot.resolve("truncated.json");
        Files.write(truncatedFile, truncated, StandardOpenOption.CREATE_NEW);
        assertBytes(truncated, Files.readAllBytes(truncatedFile), "raw NIO returns truncated bytes without JSON validation");
        System.out.println("OBSERVED truncated JSON remains readable as raw bytes; not a parser pass");
        Path malformed = caseRoot.resolve("invalid-utf8.json");
        Files.write(malformed, new byte[] {(byte) 0xC3, (byte) 0x28}, StandardOpenOption.CREATE_NEW);
        try {
            Files.readString(malformed, StandardCharsets.UTF_8);
            throw new AssertionError("Malformed UTF-8 was silently accepted");
        } catch (java.nio.charset.MalformedInputException expected) {
            System.out.println("PASS malformed UTF-8 raises MalformedInputException");
        }
        try {
            Files.readAllBytes(caseRoot);
            throw new AssertionError("Directory was treated as a regular file");
        } catch (java.io.IOException expected) {
            System.out.println("PASS reading directory as file raises " + expected.getClass().getSimpleName());
        }
    }

    private static Path newCase(String name) throws Exception {
        Path root = RUN.toRealPath();
        if (!root.equals(RUN.toAbsolutePath().normalize()) || Files.isSymbolicLink(RUN)) {
            throw new IllegalStateException("Run path escaped approved ownership");
        }
        Path fixtures = root.resolve("fixtures");
        if (!Files.isDirectory(fixtures, LinkOption.NOFOLLOW_LINKS) || !fixtures.toRealPath().equals(fixtures)) {
            throw new IllegalStateException("Unsafe fixture parent");
        }
        Path result = fixtures.resolve(name);
        Files.createDirectory(result);
        return result;
    }

    private static void assertBytes(byte[] expected, byte[] actual, String message) {
        if (!Arrays.equals(expected, actual)) {
            throw new AssertionError(message + "; expected bytes=" + expected.length + ", actual bytes=" + actual.length);
        }
    }
}
