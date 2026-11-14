package chess.hardlines;

import android.content.ContentResolver;
import android.net.Uri;
import android.webkit.WebView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import java.io.File;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The Android app's half of saving and opening a backup file, and of keeping
 * its own copy of the page's data, run on an ordinary JVM against stand-ins
 * for Android.
 *
 * WHY THIS EXISTS. The page's half is driven in a real browser by
 * tests/storage-drive.cjs, against a pretend app. Nothing drove the app's
 * half: it needs a phone, and no test here has one. So MainActivity itself —
 * the real file, unchanged — is compiled against the few dozen small classes
 * in stand-ins/, which do just enough to let it run and which remember what
 * they were asked: which chooser was opened and with what, what was written
 * to which file, what the page was told.
 *
 * WHAT IT CAN AND CANNOT SHOW. It shows that the app's own logic is right:
 * the pieces are put back together in order, the file holds exactly the text
 * as UTF-8, a character that takes two units is never cut in half, every way
 * a save or a restore can end is reported to the page, and nothing is left
 * behind when one fails; and that the app's own copy is always a whole one —
 * the last that was handed over, or the one before it, never part of either.
 * It cannot show that a real phone's file chooser and WebView behave as their
 * documentation says, nor what a phone does when a file will not open: here
 * every file opens. Those need the phone.
 */
public final class BridgeTest {
    private static int checks = 0;
    private static int failures = 0;

    private static void check(String what, Object got, Object want) {
        checks++;
        boolean ok = got == null ? want == null : got.equals(want);
        System.out.println((ok ? "ok   " : "FAIL ") + what);
        if (!ok) {
            failures++;
            System.out.println("     got  " + clip(got));
            System.out.println("     want " + clip(want));
        }
    }

    private static String clip(Object o) {
        String s = String.valueOf(o);
        return s.length() > 200 ? s.substring(0, 200) + "…" : s;
    }

    // ── the app, started, and the ways into it ─────────────────────────────

    private static final class App {
        final MainActivity activity = new MainActivity();
        final WebView web;
        final Object bridge;
        final ActivityResultLauncher<?> save;
        final ActivityResultLauncher<?> open;
        final ContentResolver files;

        App() throws Exception {
            activity.onCreate(null);
            Field field = MainActivity.class.getDeclaredField("web");
            field.setAccessible(true);
            web = (WebView) field.get(activity);
            bridge = web.interfaces.get("HardLinesAndroid");
            ActivityResultLauncher<?> s = null, o = null;
            for (ActivityResultLauncher<?> chooser : activity.choosers) {
                if (chooser.contract instanceof ActivityResultContracts.CreateDocument) s = chooser;
                if (chooser.contract instanceof ActivityResultContracts.OpenDocument) o = chooser;
            }
            save = s;
            open = o;
            files = activity.getContentResolver();
        }

        /** Call the bridge the way the page does: by name, with whatever it was given. */
        Object call(String name, Object... args) throws Exception {
            for (Method m : bridge.getClass().getDeclaredMethods()) {
                if (!m.getName().equals(name) || m.getParameterCount() != args.length) continue;
                if (m.getAnnotation(android.webkit.JavascriptInterface.class) == null) {
                    throw new IllegalStateException(name + " is not marked for the page to call");
                }
                m.setAccessible(true);
                return m.invoke(bridge, args);
            }
            throw new NoSuchMethodException(name);
        }

        /** Hand a text over as the page does: in pieces, never cutting a pair. */
        private void pieces(String method, String text, int piece) throws Exception {
            for (int at = 0; at < text.length();) {
                int end = Math.min(text.length(), at + piece);
                if (end < text.length() && Character.isHighSurrogate(text.charAt(end - 1))) end--;
                call(method, text.substring(at, end));
                at = end;
            }
        }

        void handOver(String name, String text, int piece) throws Exception {
            call("beginBackup", name);
            pieces("appendBackup", text, piece);
        }

        /** Hand over a copy to be kept. What the app answers: whether it is now the copy it keeps. */
        Object keep(String text, int piece) throws Exception {
            call("beginKeep");
            pieces("appendKeep", text, piece);
            return call("commitKeep");
        }

        /** Collect a text the app hands out a piece at a time, as the page does. */
        Collected collect(String next) throws Exception {
            Collected got = new Collected();
            for (;;) {
                String piece = (String) call(next);
                if (piece.isEmpty()) break;
                got.sizes.add(piece.length());
                got.lastOfEach.add(piece.charAt(piece.length() - 1));
                got.text.append(piece);
            }
            return got;
        }

        /** What the app has told the page since `from`, once something has been said. */
        List<String> heard(int from) throws InterruptedException {
            for (int i = 0; i < 1000 && web.said.size() <= from; i++) Thread.sleep(10);
            synchronized (web.said) {
                return new ArrayList<>(web.said.subList(Math.min(from, web.said.size()), web.said.size()));
            }
        }

        String written(Uri where) {
            return files.written.containsKey(where)
                    ? new String(files.written.get(where).toByteArray(), StandardCharsets.UTF_8) : null;
        }
    }

    private static final class Collected {
        final StringBuilder text = new StringBuilder();
        final List<Integer> sizes = new ArrayList<>();
        final List<Character> lastOfEach = new ArrayList<>();

        /** Whether any piece but the last ended on the first half of a character that takes two. */
        boolean halved() {
            for (int i = 0; i < lastOfEach.size() - 1; i++) {
                if (Character.isHighSurrogate(lastOfEach.get(i))) return true;
            }
            return false;
        }
    }

    private static File cache;
    private static File home;

    /** The app on a phone it has never run on: nothing in its cache, nothing in its files. */
    private static App fresh() throws Exception {
        cache = Files.createTempDirectory("hl-app-cache").toFile();
        home = Files.createTempDirectory("hl-app-files").toFile();
        android.content.Context.cacheDir = cache;
        android.content.Context.filesDir = home;
        return new App();
    }

    /** The app started again on the same phone. */
    private static App again() throws Exception {
        return new App();
    }

    private static String names(File dir) {
        String[] all = dir.list();
        if (all == null) return "(no such folder)";
        Arrays.sort(all);
        return String.join(" ", all);
    }

    private static String said(String function, String arguments) {
        return "window." + function + " && window." + function + "(" + arguments + ");";
    }

    /** What a file holds, or null when it is not there. */
    private static String read(File file) throws Exception {
        return file.isFile() ? new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8) : null;
    }

    /** A long text with characters of one, two and three bytes, and pairs. */
    private static String sample(int length) {
        String[] parts = {"{\"pgn\":\"1. e4 e5 2. Nf3 Nc6\",", "\"black\":\"Łukasz\",", "\"note\":\"♞ takes ♟\",", "\"name\":\"rook🏰fan\","};
        StringBuilder out = new StringBuilder();
        for (int i = 0; out.length() < length; i++) out.append(parts[i % parts.length]);
        return out.toString();
    }

    public static void main(String[] args) throws Exception {
        // ── what the app sets up ───────────────────────────────────────────
        App app = fresh();
        check("the page is given a way to files, under the name it looks for", app.bridge != null, true);
        check("and it was there before the page was loaded", app.web.loaded != null, true);
        check("it is one a WebView is certain to accept", java.lang.reflect.Modifier.isPublic(app.bridge.getClass().getModifiers()), true);
        check("a chooser for saving, offering a JSON file",
                app.save == null ? null : ((ActivityResultContracts.CreateDocument) app.save.contract).mimeType, "application/json");
        check("and a chooser for opening", app.open != null, true);
        for (String name : new String[] {"beginBackup", "appendBackup", "saveBackup", "openBackup", "openRestore", "restoreChunk", "clearRestore",
                "beginKeep", "appendKeep", "commitKeep", "openKept", "keptChunk", "closeKept"}) {
            boolean marked = false;
            for (Method m : app.bridge.getClass().getDeclaredMethods()) {
                if (m.getName().equals(name)) marked = m.getAnnotation(android.webkit.JavascriptInterface.class) != null;
            }
            check("the page may call " + name, marked, true);
        }

        // ── saving ─────────────────────────────────────────────────────────
        String text = sample(450_000);
        Uri file = new Uri("content://documents/backup-1");
        app.handOver("hard-lines-chess-backup-2026-11-14.json", text, 200_000);
        int before = app.web.said.size();
        app.call("saveBackup");
        check("the save chooser opens with the name the page gave", app.save.launched, Arrays.asList("hard-lines-chess-backup-2026-11-14.json"));
        check("and nothing is written until a place has been picked", app.files.written.size(), 0);
        check("meanwhile the backup waits, whole, in the app's cache", read(new File(cache, "backup-out.json")), text);
        app.save.answer(file);
        check("the page is told it was saved", app.heard(before), Arrays.asList(said("hardLinesBackupSaved", "true,\"\"")));
        check("the file holds the text exactly, as UTF-8", app.written(file), text);
        check("it asked for the old contents to be cut off", app.files.modes, Arrays.asList("wt"));
        check("and nothing is left behind in the cache", names(cache), "");

        // A place that will not cut a file short is written to plainly instead.
        app = fresh();
        app.files.refuseTruncate = true;
        app.handOver("b.json", text, 200_000);
        before = app.web.said.size();
        app.call("saveBackup");
        app.save.answer(file);
        check("a place that refuses that is written to plainly", app.heard(before), Arrays.asList(said("hardLinesBackupSaved", "true,\"\"")));
        check("with the same text", app.written(file), text);
        check("having tried the careful way first", app.files.modes, Arrays.asList("wt", "w"));

        // A second backup is the second backup.
        Uri second = new Uri("content://documents/backup-2");
        app.handOver("c.json", "{\"second\":true}", 200_000);
        before = app.web.said.size();
        app.call("saveBackup");
        app.save.answer(second);
        app.heard(before);
        check("a second backup carries nothing of the first", app.written(second), "{\"second\":true}");

        // A backup begun again before the first was finished is only the second.
        app.handOver("c.json", sample(250_000), 200_000);
        app.handOver("c.json", "{\"begun again\":true}", 200_000);
        before = app.web.said.size();
        app.call("saveBackup");
        app.save.answer(second);
        app.heard(before);
        check("one begun again carries nothing of the one abandoned", app.written(second), "{\"begun again\":true}");

        // A backup begun while the last one is still being written is its own.
        app = fresh();
        java.util.concurrent.CountDownLatch slow = new java.util.concurrent.CountDownLatch(1);
        app.files.holds.put(file, slow);
        app.handOver("slow.json", text, 200_000);
        before = app.web.said.size();
        app.call("saveBackup");
        app.save.answer(file);                               // …and the drive takes its time
        app.handOver("next.json", "{\"the next one\":true}", 200_000);
        slow.countDown();
        check("a backup still being written is finished", app.heard(before), Arrays.asList(said("hardLinesBackupSaved", "true,\"\"")));
        check("with all of it", app.written(file), text);
        before = app.web.said.size();
        app.call("saveBackup");
        app.save.answer(second);
        check("and one begun meanwhile is saved after it", app.heard(before), Arrays.asList(said("hardLinesBackupSaved", "true,\"\"")));
        check("holding only itself", app.written(second), "{\"the next one\":true}");
        check("with nothing left in the cache", names(cache), "");

        // Names: only what belongs in one.
        app = fresh();
        app.handOver("../../etc/pass wd?.json", "{}", 10);
        app.call("saveBackup");
        app.handOver("", "{}", 10);
        app.call("saveBackup");
        app.call("beginBackup", new Object[] {null});
        app.call("appendBackup", "{}");
        app.call("saveBackup");
        check("a name is offered without anything that is not part of a name",
                app.save.launched, Arrays.asList("....etcpasswd.json", "hard-lines-chess-backup.json", "hard-lines-chess-backup.json"));

        // Changing one's mind.
        app = fresh();
        app.handOver("d.json", text, 200_000);
        before = app.web.said.size();
        app.call("saveBackup");
        app.save.answer(null);
        check("backing out of the chooser is reported as that", app.heard(before), Arrays.asList(said("hardLinesBackupSaved", "false,\"cancelled\"")));
        check("and writes nothing", app.files.written.size(), 0);
        check("and leaves nothing waiting in the cache", names(cache), "");

        // The app restarted underneath its own chooser: what it had ready is still ready.
        app = fresh();
        app.handOver("r.json", text, 200_000);
        app.call("saveBackup");
        app = again();
        before = app.web.said.size();
        app.save.answer(file);
        check("an app restarted under its chooser still saves what it had ready", app.heard(before), Arrays.asList(said("hardLinesBackupSaved", "true,\"\"")));
        check("all of it", app.written(file), text);

        // …unless the phone cleared it away meanwhile.
        app = fresh();
        before = app.web.said.size();
        app.save.answer(file);
        check("an answer with nothing left to save is reported as lost", app.heard(before), Arrays.asList(said("hardLinesBackupSaved", "false,\"lost\"")));
        check("and the empty file the chooser made is removed", app.files.deleted, Arrays.asList(file));

        // The place cannot be written to.
        app = fresh();
        app.files.failWrites = true;
        app.handOver("e.json", text, 200_000);
        before = app.web.said.size();
        app.call("saveBackup");
        app.save.answer(file);
        check("a file that cannot be written is reported, with why",
                app.heard(before), Arrays.asList(said("hardLinesBackupSaved", "false,\"the drive is not there\"")));
        check("and nothing part-written is left", app.files.deleted, Arrays.asList(file));
        check("nor anything in the cache", names(cache), "");

        // No app on the phone to choose with.
        app = fresh();
        app.save.missing = true;
        app.handOver("f.json", text, 200_000);
        before = app.web.said.size();
        app.call("saveBackup");
        check("a phone with nothing to choose a place with is reported",
                app.heard(before), Arrays.asList(said("hardLinesBackupSaved", "false,\"this phone has no app that can save a file\"")));
        check("and what was ready is cleared away", names(cache), "");

        // Nothing handed over is nothing to save.
        app = fresh();
        app.call("appendBackup", "stray");
        app.call("appendBackup", new Object[] {null});
        before = app.web.said.size();
        app.call("saveBackup");
        check("a save with nothing handed over is reported, and asks nobody anything",
                app.heard(before) + " " + app.save.launched, Arrays.asList(said("hardLinesBackupSaved", "false,\"the app could not get the file ready\"")) + " []");
        app.call("beginBackup", "empty.json");
        before = app.web.said.size();
        app.call("saveBackup");
        check("as is one begun and never added to",
                app.heard(before) + " " + app.save.launched, Arrays.asList(said("hardLinesBackupSaved", "false,\"the app could not get the file ready\"")) + " []");

        // The cache cannot be written to at all.
        app = fresh();
        check("(the app's cache can be taken away)", cache.delete(), true);
        app.handOver("g.json", text, 200_000);
        before = app.web.said.size();
        app.call("saveBackup");
        check("an app with nowhere to get the file ready says so",
                app.heard(before) + " " + app.save.launched, Arrays.asList(said("hardLinesBackupSaved", "false,\"the app could not get the file ready\"")) + " []");

        // ── restoring ──────────────────────────────────────────────────────
        // A pair placed exactly across where the first piece would end.
        StringBuilder made = new StringBuilder(sample(199_999));
        made.setLength(199_999);
        made.append("🏰").append(sample(250_000));
        String stored = made.toString();
        Uri source = new Uri("content://documents/restore-1");

        app = fresh();
        app.files.readable.put(source, stored.getBytes(StandardCharsets.UTF_8));
        check("nothing is waiting before a file is chosen", app.call("openRestore"), 0);
        check("and there is nothing to hand over", app.call("restoreChunk"), "");
        before = app.web.said.size();
        app.call("openBackup");
        check("the open chooser accepts any kind of file", app.open.launched.size() == 1
                && Arrays.equals((String[]) app.open.launched.get(0), new String[] {"*/*"}), true);
        app.open.answer(source);
        check("the page is told a file is ready", app.heard(before), Arrays.asList(said("hardLinesRestoreReady", "")));
        check("and it opens", app.call("openRestore"), 1);
        Collected got = app.collect("restoreChunk");
        check("collected a piece at a time, it is the file exactly", got.text.toString(), stored);
        check("in pieces no longer than the app hands out", got.sizes.size() == 3 && java.util.Collections.max(got.sizes) <= 200_000, true);
        check("no piece ended halfway through a character", got.halved(), false);
        check("the piece that would have cut one stopped a unit short", got.sizes.get(0), 199_999);
        check("asking for more gives nothing", app.call("restoreChunk"), "");
        check("the page is told it had all of it", app.call("clearRestore"), true);
        check("once collected, nothing is waiting", app.call("openRestore"), 0);
        check("and nothing is left in the cache", names(cache), "");

        // Collected only in part, it is not said to be whole.
        app = fresh();
        app.files.readable.put(source, stored.getBytes(StandardCharsets.UTF_8));
        before = app.web.said.size();
        app.call("openBackup");
        app.open.answer(source);
        app.heard(before);
        app.call("openRestore");
        app.call("restoreChunk");
        check("a file collected only in part is not said to be whole", app.call("clearRestore"), false);

        // The app restarted underneath the chooser: the file is still waiting.
        app = fresh();
        app.files.readable.put(source, stored.getBytes(StandardCharsets.UTF_8));
        before = app.web.said.size();
        app.call("openBackup");
        app.open.answer(source);
        app.heard(before);
        app = again();
        check("a file chosen before the app was restarted is still waiting", app.call("openRestore"), 1);
        check("all of it", app.collect("restoreChunk").text.toString(), stored);
        check("and whole", app.call("clearRestore"), true);

        // A second choice is the second choice.
        app = fresh();
        Uri other = new Uri("content://documents/restore-2");
        app.files.readable.put(source, stored.getBytes(StandardCharsets.UTF_8));
        app.files.readable.put(other, "{\"other\":true}".getBytes(StandardCharsets.UTF_8));
        before = app.web.said.size();
        app.call("openBackup");
        app.open.answer(source);
        app.heard(before);
        before = app.web.said.size();
        app.call("openBackup");
        app.open.answer(other);
        app.heard(before);
        app.call("openRestore");
        check("a second file chosen is the one handed over", app.collect("restoreChunk").text.toString(), "{\"other\":true}");
        app.call("clearRestore");

        // A file chosen while an earlier one is still coming in takes its place.
        app = fresh();
        app.files.readable.put(source, stored.getBytes(StandardCharsets.UTF_8));
        app.files.readable.put(other, "{\"other\":true}".getBytes(StandardCharsets.UTF_8));
        slow = new java.util.concurrent.CountDownLatch(1);
        app.files.holds.put(source, slow);
        app.call("openBackup");
        app.open.answer(source);                             // …from a drive that takes its time
        before = app.web.said.size();
        app.call("openBackup");
        app.open.answer(other);
        check("a file chosen while another is still coming in is ready first", app.heard(before), Arrays.asList(said("hardLinesRestoreReady", "")));
        slow.countDown();
        for (int i = 0; i < 300 && names(cache).contains(".part"); i++) Thread.sleep(10);
        Thread.sleep(50);
        check("the earlier one gives way, and says nothing", app.web.said.size() - before, 1);
        app.call("openRestore");
        check("and the later one is what is handed over", app.collect("restoreChunk").text.toString(), "{\"other\":true}");
        check("whole", app.call("clearRestore"), true);
        check("with nothing left in the cache", names(cache), "");

        app = fresh();
        before = app.web.said.size();
        app.call("openBackup");
        app.open.answer(null);
        check("backing out of the open chooser is reported as that", app.heard(before), Arrays.asList(said("hardLinesRestoreCancelled", "")));

        app = fresh();
        before = app.web.said.size();
        app.call("openBackup");
        app.open.answer(new Uri("content://documents/gone"));
        check("a file that cannot be read is reported, with why", app.heard(before), Arrays.asList(said("hardLinesRestoreFailed", "\"no such file\"")));
        check("and nothing is left waiting", app.call("openRestore") + " " + names(cache), "0 ");

        // A file far too big to be a backup is refused before it fills the phone.
        app = fresh();
        app.files.source = new InputStream() {
            private long left = 256L * 1024 * 1024 + 1;
            @Override public int read() { return left-- > 0 ? 'a' : -1; }
            @Override public int read(byte[] b, int off, int len) {
                if (left <= 0) return -1;
                int n = (int) Math.min(len, left);
                Arrays.fill(b, off, off + n, (byte) 'a');
                left -= n;
                return n;
            }
        };
        before = app.web.said.size();
        app.call("openBackup");
        app.open.answer(source);
        check("a file too large to be a backup is refused", app.heard(before), Arrays.asList(said("hardLinesRestoreFailed", "\"the file is too large to be a backup\"")));
        check("and nothing of it is kept", app.call("openRestore") + " " + names(cache), "0 ");

        app = fresh();
        app.open.missing = true;
        before = app.web.said.size();
        app.call("openBackup");
        check("a phone with nothing to choose a file with is reported",
                app.heard(before), Arrays.asList(said("hardLinesRestoreFailed", "\"this phone has no app that can open a file\"")));

        // ── the app's own copy ─────────────────────────────────────────────
        app = fresh();
        File kept = new File(home, "kept-copy.json");
        File part = new File(home, "kept-copy.json.part");
        check("before any copy has been kept, the page is told there is none", app.call("openKept"), 0);
        check("a copy handed over is taken", app.keep(stored, 200_000), true);
        check("and kept in the app's own files, exactly", read(kept), stored);
        check("with nothing part-written left beside it", names(home), "kept-copy.json");

        // The next time the app starts, it is there.
        app = again();
        check("the next time the app starts, the copy opens", app.call("openKept"), 1);
        got = app.collect("keptChunk");
        check("collected a piece at a time, it is the copy exactly", got.text.toString(), stored);
        check("no piece of it ended halfway through a character", got.halved(), false);
        check("the piece that would have stopped a unit short", got.sizes.get(0), 199_999);
        check("the page is told it had all of it", app.call("closeKept"), true);
        check("once collected, there is nothing more to hand over", app.call("keptChunk"), "");
        check("and the copy itself is still kept", read(kept), stored);
        app.call("openKept");
        app.call("keptChunk");
        check("a copy collected only in part is not said to be whole", app.call("closeKept"), false);

        // Each copy replaces the last, whole.
        for (int i = 1; i <= 20; i++) app.keep("{\"copy\":" + i + "}" + sample(300_000), 200_000);
        check("each copy replaces the one before it", read(kept), "{\"copy\":20}" + sample(300_000));
        check("and still nothing part-written is left", names(home), "kept-copy.json");

        // A copy being read is not disturbed by a new one being made.
        app.keep(stored, 200_000);
        app.call("openKept");
        String first = (String) app.call("keptChunk");
        app.keep("{\"newer\":true}", 200_000);
        StringBuilder rest = new StringBuilder(first);
        rest.append(app.collect("keptChunk").text);
        check("a copy being collected is the one that was opened, though a newer is made meanwhile", rest.toString(), stored);
        check("and whole", app.call("closeKept"), true);
        check("while the newer one is what is kept", read(kept), "{\"newer\":true}");

        // A backup waiting for its chooser is a different thing in hand.
        app.handOver("g.json", text, 200_000);
        app.call("saveBackup");
        check("a copy can be kept while a backup waits for its chooser", app.keep(stored, 200_000), true);
        before = app.web.said.size();
        app.save.answer(file);
        check("and the backup is then saved all the same", app.heard(before), Arrays.asList(said("hardLinesBackupSaved", "true,\"\"")));
        check("holding the backup, not the copy", app.written(file), text);
        check("as the copy holds the copy", read(kept), stored);

        // Nothing handed over is not a copy.
        check("a copy never begun is not taken", app.call("commitKeep"), false);
        app.call("beginKeep");
        check("nor one begun and never added to", app.call("commitKeep"), false);
        app.call("appendKeep", "stray");
        check("nor a stray piece", app.call("commitKeep"), false);
        check("and the copy kept is as it was", read(kept) + " | " + names(home), stored + " | kept-copy.json");

        // A copy that cannot be written leaves the last one whole.
        // (A folder with something in it, where the copy is written first: it
        // can neither be written to nor cleared out of the way.)
        File inTheWay = new File(part, "in-the-way");
        check("(the place a copy is written first can be blocked)", part.mkdir() && inTheWay.createNewFile(), true);
        check("a copy that cannot be written is not said to be kept", app.keep("{\"blocked\":true}", 200_000), false);
        check("and leaves the last one as it was", read(kept), stored);
        inTheWay.delete();
        part.delete();
        check("the next one that can be written is", app.keep("{\"unblocked\":true}", 200_000) + " " + read(kept), "true {\"unblocked\":true}");

        // No file, or an empty one, is no copy.
        kept.delete();
        check("with the file gone there is none", app.call("openKept"), 0);
        check("(an empty file can be put there)", kept.createNewFile(), true);
        check("and an empty file is none too", app.call("openKept"), 0);

        // What a stopped app left half-done is cleared away when it next starts;
        // what was finished and waiting is not.
        app = fresh();
        app.handOver("w.json", text, 200_000);
        app.call("saveBackup");                              // finished, and waiting for its chooser
        app.keep(stored, 200_000);
        app.call("beginKeep");
        app.call("appendKeep", "half a copy");               // …and stopped here
        Files.write(new File(cache, "backup-out.json.123.going").toPath(), new byte[] {1});
        Files.write(new File(cache, "backup-in.json.7.part").toPath(), new byte[] {1});
        app = again();
        check("starting again clears away what was half-done, and keeps what was waiting",
                names(cache) + " | " + names(home), "backup-out.json | kept-copy.json");
        check("the copy kept is the last whole one", read(new File(home, "kept-copy.json")), stored);

        // Leaving the app is when the copy is refreshed.
        app = fresh();
        before = app.web.said.size();
        app.activity.onPause();
        check("when the app is left, the page is asked to refresh the copy", app.heard(before), Arrays.asList(said("hardLinesLeaving", "")));

        System.out.println(checks + " checks, " + failures + " failed");
        if (failures > 0) System.exit(1);
    }
}
