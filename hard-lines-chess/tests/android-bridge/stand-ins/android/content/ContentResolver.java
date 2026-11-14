package android.content;
import android.net.Uri;
import java.io.*;
import java.util.*;
/** Files, as a map from address to bytes — and a way to make any of it fail. */
public class ContentResolver {
    public final Map<Uri, byte[]> readable = new HashMap<>();
    public final Map<Uri, ByteArrayOutputStream> written = new HashMap<>();
    public final List<String> modes = new ArrayList<>();
    public final List<Uri> deleted = new ArrayList<>();
    public boolean refuseTruncate = false;
    public boolean failWrites = false;
    public InputStream source = null;
    /** A place that is slow to answer: opening it waits here until the test lets it go. */
    public final Map<Uri, java.util.concurrent.CountDownLatch> holds = new HashMap<>();
    private void wait(Uri u) {
        java.util.concurrent.CountDownLatch hold = holds.get(u);
        if (hold == null) return;
        try { hold.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
    public InputStream openInputStream(Uri u) throws FileNotFoundException {
        wait(u);
        if (source != null) return source;
        byte[] bytes = readable.get(u);
        if (bytes == null) throw new FileNotFoundException("no such file");
        return new ByteArrayInputStream(bytes);
    }
    public OutputStream openOutputStream(Uri u, String mode) throws FileNotFoundException {
        wait(u);
        modes.add(mode);
        if (failWrites) throw new FileNotFoundException("the drive is not there");
        if (refuseTruncate && mode.contains("t")) throw new IllegalArgumentException("unsupported mode");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        written.put(u, out);
        return out;
    }
}
