package github.gtouming.what_guys_doing.world;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/** 单个 lowres tile：上半颜色，下半 height/blockLight；尺寸 tileSize + 1 border。 */
public final class LowresTile {
    private final int tileSize;
    private final BufferedImage image;
    private boolean modified;

    public LowresTile(int tileSize) {
        this.tileSize = tileSize;
        this.image = new BufferedImage(tileSize + 1, (tileSize + 1) * 2, BufferedImage.TYPE_INT_ARGB);
        this.modified = false;
    }

    public LowresTile(int tileSize, BufferedImage image) {
        this.tileSize = tileSize;
        this.image = image;
        this.modified = false;
    }

    public static LowresTile read(Path file, int tileSize) {
        if (!Files.isRegularFile(file)) return null;
        try {
            BufferedImage image = ImageIO.read(file.toFile());
            if (image == null
                    || image.getWidth() != tileSize + 1
                    || image.getHeight() != (tileSize + 1) * 2) return null;
            return new LowresTile(tileSize, image);
        } catch (IOException e) {
            return null;
        }
    }

    public int size() {
        return tileSize + 1;
    }

    public BufferedImage image() {
        return image;
    }

    public boolean isModified() {
        return modified;
    }

    public void markModified() {
        this.modified = true;
    }

    public synchronized void set(int x, int z, int color, int height, int light) {
        int size = tileSize + 1;
        image.setRGB(x, z, color);
        image.setRGB(x, size + z,
                (height & 0xFFFF) | ((light & 0xFF) << 16) | 0xFF000000);
        this.modified = true;
    }

    public int color(int x, int z) {
        return image.getRGB(x, z);
    }

    public int height(int x, int z) {
        int meta = image.getRGB(x, tileSize + 1 + z);
        int h = meta & 0xFFFF;
        return h >= 0x8000 ? h - 0x10000 : h;
    }

    public int blockLight(int x, int z) {
        return (image.getRGB(x, tileSize + 1 + z) >> 16) & 0xFF;
    }

    public boolean isEmpty() {
        int size = tileSize + 1;
        for (int z = 0; z < size; z++) {
            for (int x = 0; x < size; x++) {
                if ((image.getRGB(x, z) & 0x00FFFFFF) != 0 || (image.getRGB(x, z) >>> 24) != 0) {
                    return false;
                }
            }
        }
        return true;
    }

    public void save(Path file) throws IOException {
        Path tmp = file.resolveSibling(file.getFileName() + ".tmp-" + Thread.currentThread().getId());
        try {
            Files.createDirectories(file.getParent());
            ImageIO.write(image, "png", tmp.toFile());
            try {
                Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
            }
            this.modified = false;
        } finally {
            Files.deleteIfExists(tmp);
        }
    }
}
