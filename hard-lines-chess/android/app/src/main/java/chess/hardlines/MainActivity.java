package chess.hardlines;

import android.annotation.SuppressLint;
import android.content.ContentResolver;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * The whole app is one HTML file in assets/. This is the window it opens in.
 *
 * THE APP REACHES ONE PLACE OUTSIDE ITSELF, AND IT IS NAMED HERE: Chess.com's
 * public archive of a player's games, read and never written to, so that new
 * games can be brought in without being typed. Every other request the page
 * makes is answered from the APK or refused — see shouldInterceptRequest —
 * so everything but that import works the same with no network at all. See
 * AndroidManifest.xml for why the permission is there and what keeps it to
 * this.
 */
public class MainActivity extends ComponentActivity {

    /**
     * WHY THE PAGE IS SERVED OVER https AND NOT LOADED AS A file:// URL.
     *
     * The trainer keeps every game, drill and setting in the WebView's own
     * storage — its database, and before version 1.6 localStorage. A page
     * loaded from file:// has an opaque origin: its storage is unreliable, and
     * window.isSecureContext is false — which the page itself checks before it
     * will register anything. WebViewAssetLoader answers requests to this
     * reserved name from the APK's own assets, so the page runs on an ordinary
     * secure origin and its storage is ordinary storage that survives closing.
     *
     * THE NAME MUST NEVER CHANGE. Storage belongs to the origin, so a new name
     * would be a new, empty app as far as the page could tell, with every
     * game still on the phone and out of its reach.
     */
    private static final String DOMAIN = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + DOMAIN + "/assets/index.html";

    /** The host the page links its typefaces from, which this answers locally. */
    private static final String FONT_CSS_HOST = "fonts.googleapis.com";

    /**
     * THE ONE PLACE THE APP FETCHES FROM: Chess.com's public archive of a
     * player's games — https, this host, under this path, and only to read.
     * It needs no key and no password and is sent nothing but the player's
     * name. Kept in step with CHESSCOM_API in src/import.js by
     * tests/android-reach.test.mjs.
     */
    private static final String ARCHIVE_HOST = "api.chess.com";
    private static final String ARCHIVE_PATH = "/pub/player/";

    /**
     * The same rule, given to the page itself. A request the page makes with
     * fetch is seen by shouldInterceptRequest and refused there; a socket it
     * opened would not be. This is the browser's own lock on both: the page
     * may connect to where it came from and to the archive, and nowhere else.
     * Nothing in the page tries to — this is what stops a later change from
     * doing it unnoticed.
     */
    private static final String PAGE_POLICY = "connect-src 'self' https://" + ARCHIVE_HOST;

    /** How long a first back press stays counted, in milliseconds. */
    private static final long LEAVE_WINDOW = 2000L;

    /** The largest file the app will take in as a backup, in bytes. Years of games are a few million. */
    private static final long RESTORE_LIMIT = 256L * 1024 * 1024;

    /** How much of a file is handed to the page at a time, in characters. */
    private static final int RESTORE_CHUNK = 200_000;

    /**
     * The app's own copy of everything the page keeps, in the app's private
     * files. THE NAME MUST NEVER CHANGE, for the reason the origin's must not:
     * a copy under another name is a copy the app can no longer find.
     */
    private static final String KEPT_FILE = "kept-copy.json";

    private WebView web;
    private FrameLayout root;
    private long lastBackPress = 0L;

    // ── a backup on its way out, and one on its way in ─────────────────────
    //
    // NOTHING HERE IS EVER HELD WHOLE IN MEMORY. A history is a few million
    // characters and grows for as long as the app is used; held as text, then
    // as bytes, it is several times that at once, and the day it no longer
    // fits is the day a backup cannot be made. So each text goes to a file as
    // its pieces arrive, and comes back from one a piece at a time.
    //
    // Touched from several threads — the page calls in on the WebView's own,
    // the choosers answer on the main one, and files are copied on their own
    // — so all four are used only while holding `files`.
    private final Object files = new Object();
    private String backupName = "hard-lines-chess-backup.json";
    /** A backup on its way out: taken from the page, waiting for the chooser to say where it goes. */
    private Taken backupOut;
    /** A backup on its way in: copied from where it was chosen, waiting for the page to collect it. */
    private Given restoreIn;
    /** The app's own copy of everything the page keeps, on its way in to be kept… */
    private Taken keepOut;
    /** …and on its way back out to the page. */
    private Given keptIn;
    /** Which choice of a file to restore from is the latest: an earlier one still being copied in gives way. */
    private int restoreTurn = 0;
    private ActivityResultLauncher<String> saveChooser;
    private ActivityResultLauncher<String[]> openChooser;
    /** Asking Android whether the app may show notifications; see Reminder. */
    private ActivityResultLauncher<String> notifyAsk;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ── a backup file out, and one back in ─────────────────────────────
        //
        // Registered here, before the activity starts, because that is the
        // only moment Android accepts it. NEITHER NEEDS A PERMISSION: the
        // system's own chooser does the choosing, and the app is handed the
        // one file the person picked and nothing else on the phone.
        saveChooser = registerForActivityResult(
                new ActivityResultContracts.CreateDocument("application/json"), this::writeBackup);
        openChooser = registerForActivityResult(
                new ActivityResultContracts.OpenDocument(), this::readBackup);

        // ── the daily reminder ─────────────────────────────────────────────
        //
        // The one thing the app asks leave for, and only when the reminder is
        // turned on. Whatever the answer, the page is told there is one, and
        // reads how things stand for itself.
        notifyAsk = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> tellPage("hardLinesReminderChanged", ""));

        // A backup in either direction passes through the app's cache, which
        // the phone may clear when it likes: it is only ever on its way
        // somewhere. The app's own copy is kept in its files, which the phone
        // leaves alone.
        final File kept = new File(getFilesDir(), KEPT_FILE);
        sweep(getCacheDir());
        sweep(getFilesDir());
        backupOut = new Taken(new File(getCacheDir(), "backup-out.json"));
        restoreIn = new Given(new File(getCacheDir(), "backup-in.json"));
        keepOut = new Taken(kept);
        keptIn = new Given(kept);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(DOMAIN)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Painted before the page is, so opening the app is never a white
        // flash on the way to a dark board.
        web.setBackgroundColor(getColor(R.color.page));

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        // The game's save file. Without this every drill, game and setting is
        // forgotten the moment the app closes. (The page's database needs no
        // switch of its own; this one is for the small store it moved out of,
        // which it still reads on the way.)
        settings.setDomStorageEnabled(true);
        // Nothing is cached. The assets are their own cache — an HTTP cache
        // layered over an APK asset can only ever serve an older app than the
        // one installed — and the one thing fetched, the list of a player's
        // games, is wanted as it stands now.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setGeolocationEnabled(false);

        // WHAT TELLS THE PAGE WHERE IT IS. The page offers to install itself
        // and to save a copy of itself, and both are nonsense inside an app
        // that is already installed. It looks for this marker and says the
        // true thing instead — see setupInstall() in src/app-d.js.
        settings.setUserAgentString(
                settings.getUserAgentString() + " HardLinesAndroid/" + BuildConfig.VERSION_NAME);

        // The page styles its own dark theme with prefers-color-scheme. A
        // WebView reports "light" to that query unless the app opts in, so
        // without this the app is stuck in daylight on a dark phone. On a
        // WebView too old to support the opt-in the page opens light and the
        // theme picker in its own settings still works.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, true);
        }

        // WHAT LETS THE PAGE SAVE AND OPEN A BACKUP FILE, AND KEEP A COPY OF
        // ITS DATA WHERE THE PHONE WILL NOT CLEAR IT. A page in a WebView
        // cannot start a download, its file inputs do nothing, and it has no
        // files of its own, so the app does all three for it — see
        // FileBridge. Only the bundled page ever runs in this window (every
        // other address is refused below), so it is the only thing that can
        // call this.
        web.addJavascriptInterface(new FileBridge(), "HardLinesAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();

                // The page links a Google Fonts stylesheet. Answer it from the
                // APK: the faces are bundled, so the app's typography is the
                // same offline as on and — more to the point — a page waiting
                // on an unreachable stylesheet is a page that has not painted.
                if (FONT_CSS_HOST.equalsIgnoreCase(url.getHost())) {
                    return fontStylesheet();
                }

                // THE ENGINE HAS TO BE LABELLED AS WHAT IT IS. Stockfish's
                // loader compiles its .wasm with instantiateStreaming, which
                // refuses anything not sent as application/wasm — and the
                // asset loader's guess at a type is a guess, varying by
                // library version. Answered here so it is never left to one.
                String path = url.getPath();
                if (DOMAIN.equalsIgnoreCase(url.getHost()) && path != null
                        && path.startsWith("/assets/") && path.endsWith(".wasm")) {
                    WebResourceResponse wasm = asset(path.substring("/assets/".length()), "application/wasm");
                    if (wasm != null) return wasm;
                }

                WebResourceResponse local = loader.shouldInterceptRequest(url);
                if (local != null) return sealed(local);

                // THE ONE REQUEST THAT GOES OUT: a read of Chess.com's public
                // archive. Null hands it to the WebView to fetch.
                if (isGameArchive(request)) return null;

                // ANYTHING ELSE IS REFUSED RATHER THAN FETCHED. Nothing in the
                // app asks for anything else; if something ever does, failing
                // here makes it visible instead of quietly giving the app a
                // second place it talks to.
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                        new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // The app is one page with no links out. A navigation away
                // from the bundled origin could only be a blank screen with no
                // way back, so it stays here.
                return !DOMAIN.equalsIgnoreCase(request.getUrl().getHost());
            }
        });

        // ── the bars, and what sits under them ─────────────────────────────
        //
        // From Android 15 an app draws behind the status and navigation bars
        // whether it asks to or not. The page has no safe-area padding of its
        // own, so its top row would sit under the clock. The container is
        // padded by the bars instead, and the window background — the page's
        // own colour, light or dark — fills what is left.
        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.page));
        root.addView(web);
        setContentView(root);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout()
                            | WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        applyBarIconContrast();

        // ── back ───────────────────────────────────────────────────────────
        //
        // A game in progress lives in the page, not on disk, so one stray
        // edge-swipe should not end it. The first press says so; a second
        // within two seconds is taken as meant.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web != null && web.canGoBack()) {
                    web.goBack();
                    return;
                }
                long now = System.currentTimeMillis();
                if (now - lastBackPress < LEAVE_WINDOW) {
                    finish();
                } else {
                    lastBackPress = now;
                    Toast.makeText(MainActivity.this, R.string.back_again_to_leave, Toast.LENGTH_SHORT).show();
                }
            }
        });

        // Restore only if there is something to restore. restoreState returns
        // null when the saved bundle holds no history, and the first version
        // of this trusted the bundle's mere existence — which after the system
        // had killed the app for memory meant it reopened on a blank screen.
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(START_URL);
        }
    }

    /**
     * The page's way to a file, since a page in a WebView has none of its own
     * — and to the daily reminder, which has to be kept outside the page
     * because it fires when the page is not running.
     *
     * TEXT CROSSES A PIECE AT A TIME, in both directions. A backup is a few
     * million characters and the bridge between the page and the app is built
     * for small messages, so neither side ever hands the other the whole of
     * it at once — and no piece ends in the middle of a character that takes
     * two (an emoji in a player's name), which would arrive as two broken
     * halves.
     *
     * These are called on the WebView's own thread, not the main one, which
     * is why everything they touch is guarded and anything that puts up a
     * screen is posted across. The page's half is in src/backup.js, and
     * tests/store.test.mjs holds the two to the same names.
     */
    public final class FileBridge {
        // ── the daily reminder: see Reminder, and src/app-r.js ─────────────

        /** How the reminder stands: on or off, its time, and whether Android will show it. */
        @JavascriptInterface
        public String reminder() {
            return "{\"on\":" + Reminder.isOn(MainActivity.this)
                    + ",\"hour\":" + Reminder.hour(MainActivity.this)
                    + ",\"minute\":" + Reminder.minute(MainActivity.this)
                    + ",\"allowed\":" + Reminder.allowed(MainActivity.this) + "}";
        }

        /**
         * Turn the reminder on at a time, or off. Turning it on is the moment
         * Android is asked whether notifications may be shown, where it has to
         * be asked; either way the page hears when there is something to read.
         */
        @JavascriptInterface
        public void setReminder(final boolean on, final int hour, final int minute) {
            Reminder.set(MainActivity.this, on, hour, minute);
            final boolean ask = on && Build.VERSION.SDK_INT >= 33 && !Reminder.allowed(MainActivity.this);
            runOnUiThread(() -> {
                if (ask) notifyAsk.launch(Reminder.MAY_NOTIFY);
                else tellPage("hardLinesReminderChanged", "");
            });
        }

        /** The page says a session was finished: on which day, and how long the run of days then was. */
        @JavascriptInterface
        public void sessionDone(String day, int run) {
            Reminder.done(MainActivity.this, day, run);
        }

        // ── files ──────────────────────────────────────────────────────────

        /** Start handing over a backup, under the name it should be offered as. */
        @JavascriptInterface
        public void beginBackup(String name) {
            synchronized (files) {
                backupName = safeName(name);
                backupOut.begin();
            }
        }

        /** The next piece of it. */
        @JavascriptInterface
        public void appendBackup(String piece) {
            synchronized (files) {
                backupOut.append(piece);
            }
        }

        /** All of it is here: ask where it should be kept. The answer goes to writeBackup(). */
        @JavascriptInterface
        public void saveBackup() {
            final String name;
            final boolean whole;
            synchronized (files) {
                name = backupName;
                whole = backupOut.finish();
            }
            runOnUiThread(() -> {
                if (!whole) {
                    tellPage("hardLinesBackupSaved",
                            "false," + JSONObject.quote("the app could not get the file ready"));
                    return;
                }
                try {
                    saveChooser.launch(name);
                } catch (RuntimeException noChooser) {
                    synchronized (files) {
                        backupOut.discard();
                    }
                    tellPage("hardLinesBackupSaved",
                            "false," + JSONObject.quote("this phone has no app that can save a file"));
                }
            });
        }

        /** Ask which file to restore from. The answer goes to readBackup(). */
        @JavascriptInterface
        public void openBackup() {
            runOnUiThread(() -> {
                try {
                    // ANY TYPE. A .json file is labelled differently by every
                    // file manager and every cloud drive, and a file that has
                    // been filtered out is a file that cannot be picked. The
                    // page checks what it is given before it touches anything.
                    openChooser.launch(new String[] {"*/*"});
                } catch (RuntimeException noChooser) {
                    tellPage("hardLinesRestoreFailed",
                            JSONObject.quote("this phone has no app that can open a file"));
                }
            });
        }

        /**
         * Open the file that is waiting to be collected. 1 when there is one
         * and it is open; nought when there is none; -1 when there is one and
         * it would not open.
         */
        @JavascriptInterface
        public int openRestore() {
            synchronized (files) {
                return restoreIn.open();
            }
        }

        /** The next piece of it; nothing when there is no more. */
        @JavascriptInterface
        public String restoreChunk() {
            synchronized (files) {
                return restoreIn.next();
            }
        }

        /** The page has done with it. True when it was handed over whole, to the last piece. */
        @JavascriptInterface
        public boolean clearRestore() {
            synchronized (files) {
                boolean whole = restoreIn.close();
                restoreIn.discard();
                return whole;
            }
        }

        // ── the app's own copy ─────────────────────────────────────────────
        //
        // THE PAGE KEEPS EVERYTHING IN THE WEBVIEW'S DATABASE, AND A PHONE
        // THAT IS VERY SHORT OF SPACE CAN CLEAR THAT. A website can ask to be
        // spared; a page inside an app cannot. What the phone does leave
        // alone is an app's own files. So the page hands over a copy of
        // everything whenever the app is left, it is kept here, and the page
        // asks for it back when it finds its database empty or behind.
        //
        // Kept apart from a backup on its way to a chooser, because the two
        // can be in hand at once: opening the chooser is itself a moment the
        // app is left.

        /** Start handing over the copy. */
        @JavascriptInterface
        public void beginKeep() {
            synchronized (files) {
                keepOut.begin();
            }
        }

        /** The next piece of it. */
        @JavascriptInterface
        public void appendKeep(String piece) {
            synchronized (files) {
                keepOut.append(piece);
            }
        }

        /** All of it is here. True when it is now the copy the app keeps; false leaves the last one as it was. */
        @JavascriptInterface
        public boolean commitKeep() {
            synchronized (files) {
                return keepOut.finish();
            }
        }

        /**
         * Open the copy. 1 when there is one and it is open; nought when
         * there is none; and -1 when there is one and it would not open —
         * which the page must not take for "none", or it would write a new
         * one over it.
         */
        @JavascriptInterface
        public int openKept() {
            synchronized (files) {
                return keptIn.open();
            }
        }

        /** The next piece of it; nothing when there is no more. */
        @JavascriptInterface
        public String keptChunk() {
            synchronized (files) {
                return keptIn.next();
            }
        }

        /** The page has done with it. True when it was handed over whole, to the last piece. */
        @JavascriptInterface
        public boolean closeKept() {
            synchronized (files) {
                return keptIn.close();
            }
        }
    }

    /**
     * A text taken a piece at a time, into a file that has its real name only
     * once it holds the whole of it.
     *
     * It is written beside any file already there and then moved over it, so
     * that whatever is under the real name is always complete: the app can be
     * stopped at any moment, and a file cut short would be read later as if
     * it were all there was.
     */
    private static final class Taken {
        private final File whole;
        private final File part;
        private FileOutputStream file;
        private Writer out;
        private boolean failed;
        private boolean any;

        Taken(File whole) {
            this.whole = whole;
            this.part = new File(whole.getPath() + ".part");
        }

        void begin() {
            abandon();
            failed = false;
            any = false;
            try {
                file = new FileOutputStream(part);
                out = new BufferedWriter(new OutputStreamWriter(file, StandardCharsets.UTF_8), 64 * 1024);
            } catch (IOException | RuntimeException noRoom) {
                failed = true;
            }
        }

        void append(@Nullable String piece) {
            if (out == null || failed || piece == null || piece.isEmpty()) return;
            try {
                out.write(piece);
                any = true;
            } catch (IOException | RuntimeException noRoom) {
                failed = true;
            }
        }

        /** There is no more to come. True when all of it is now in the file under its real name. */
        boolean finish() {
            if (out == null) {
                // Nothing was begun, or it could not be: there is nothing to finish.
                part.delete();
                return false;
            }
            boolean ok = !failed && any;
            try {
                out.flush();
                // On the disk, not on its way there, before it takes the name.
                file.getFD().sync();
            } catch (IOException | RuntimeException noRoom) {
                ok = false;
            }
            try {
                out.close();
            } catch (IOException | RuntimeException noRoom) {
                ok = false;
            }
            out = null;
            file = null;
            ok = ok && part.renameTo(whole);
            if (!ok) part.delete();
            return ok;
        }

        /** Stop, and leave nothing part-written. Whatever is under the real name stays. */
        void abandon() {
            if (out != null) {
                try {
                    out.close();
                } catch (IOException | RuntimeException ignored) {
                    // It is being thrown away.
                }
            }
            out = null;
            file = null;
            part.delete();
        }

        /**
         * Take the finished file out from under its name, to be sent on its
         * way: the next text begun here then cannot touch it, however soon it
         * is begun. Null when there is no finished file.
         */
        @Nullable
        File claim() {
            if (!whole.isFile()) return null;
            File going = new File(whole.getPath() + "." + System.nanoTime() + ".going");
            return whole.renameTo(going) ? going : null;
        }

        /** Remove the finished file as well: it was on its way somewhere, and will not be going. */
        void discard() {
            abandon();
            whole.delete();
        }
    }

    /**
     * Clear away what a stopped app left half-done: a file that was still
     * being written, or one that was on its way out. A finished file that is
     * still waiting — for its chooser, or for the page — is not touched.
     */
    private static void sweep(@Nullable File dir) {
        File[] all = dir == null ? null : dir.listFiles();
        if (all == null) return;
        for (File one : all) {
            String name = one.getName();
            if (one.isFile() && (name.endsWith(".part") || name.endsWith(".going"))) one.delete();
        }
    }

    /** A text file handed out a piece at a time, never ending a piece between the two halves of one character. */
    private static final class Given {
        private final File from;
        private Reader in;
        private int held = -1;
        private boolean ended;
        private boolean failed;

        Given(File from) {
            this.from = from;
        }

        /** The file other code fills: written under another name first, so that it is only ever here whole. */
        File file() {
            return from;
        }

        /** 1 when it is there and open, nought when it is not there, -1 when it is there and would not open. */
        int open() {
            close();
            if (!from.isFile() || from.length() == 0) return 0;
            try {
                in = new BufferedReader(new InputStreamReader(new FileInputStream(from), StandardCharsets.UTF_8), 64 * 1024);
                held = -1;
                ended = false;
                failed = false;
                return 1;
            } catch (IOException | RuntimeException unreadable) {
                in = null;
                return -1;
            }
        }

        /** The next piece; nothing when there is no more, or when it could not be read — close() says which. */
        String next() {
            if (in == null || ended || failed) return "";
            try {
                char[] buffer = new char[RESTORE_CHUNK];
                int filled = 0;
                if (held >= 0) {
                    buffer[filled++] = (char) held;
                    held = -1;
                }
                while (filled < buffer.length) {
                    int read = in.read(buffer, filled, buffer.length - filled);
                    if (read == -1) {
                        ended = true;
                        break;
                    }
                    filled += read;
                }
                // The first half of a character that takes two waits for the next piece.
                if (!ended && filled > 0 && Character.isHighSurrogate(buffer[filled - 1])) held = buffer[--filled];
                return new String(buffer, 0, filled);
            } catch (IOException | RuntimeException | OutOfMemoryError unreadable) {
                failed = true;
                return "";
            }
        }

        /** Done with it. True when all of it was handed out, to the end, with nothing going wrong. */
        boolean close() {
            boolean whole = in != null && ended && !failed && held < 0;
            if (in != null) {
                try {
                    in.close();
                } catch (IOException | RuntimeException ignored) {
                    // Nothing more was wanted from it.
                }
            }
            in = null;
            return whole;
        }

        /** Remove the file: it was on its way to the page, and has been collected or will not be. */
        void discard() {
            close();
            from.delete();
        }
    }

    /** Whether a request is a read of Chess.com's public archive of a player's games, and nothing else. */
    private static boolean isGameArchive(WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        return "https".equalsIgnoreCase(url.getScheme())
                && ARCHIVE_HOST.equalsIgnoreCase(url.getHost())
                && (url.getPort() == -1 || url.getPort() == 443)
                && path != null && path.startsWith(ARCHIVE_PATH)
                && "GET".equalsIgnoreCase(request.getMethod());
    }

    /** Something served from inside the app, with the rule about where the page may connect attached. */
    private static WebResourceResponse sealed(WebResourceResponse response) {
        Map<String, String> headers = new HashMap<>();
        if (response.getResponseHeaders() != null) headers.putAll(response.getResponseHeaders());
        headers.put("Content-Security-Policy", PAGE_POLICY);
        response.setResponseHeaders(headers);
        return response;
    }

    /** A name the chooser can be handed: the page's suggestion, less anything that is not part of a file name. */
    private static String safeName(@Nullable String name) {
        String cleaned = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "");
        return cleaned.isEmpty() ? "hard-lines-chess-backup.json" : cleaned;
    }

    /** What went wrong, in the exception's own words where it has any. */
    private static String reason(Throwable e) {
        return e.getMessage() == null || e.getMessage().isEmpty() ? e.getClass().getSimpleName() : e.getMessage();
    }

    /** Call one of the page's own functions, if the page is there and has it. Main thread only. */
    private void tellPage(String function, String arguments) {
        if (web == null) return;
        web.evaluateJavascript("window." + function + " && window." + function + "(" + arguments + ");", null);
    }

    /** The chooser has said where the backup should go — or that it should not go anywhere. */
    private void writeBackup(@Nullable Uri where) {
        final File ready;
        synchronized (files) {
            ready = backupOut.claim();
        }
        if (where == null) {
            if (ready != null) ready.delete();
            tellPage("hardLinesBackupSaved", "false,\"cancelled\"");
            return;
        }
        final ContentResolver resolver = getContentResolver();
        if (ready == null) {
            // The app was closed underneath its own chooser and the phone has
            // cleared away the file that was waiting. The chooser has already
            // made the place for it, empty; an empty "backup" is worse than
            // none, because it looks like one.
            discard(resolver, where);
            tellPage("hardLinesBackupSaved", "false,\"lost\"");
            return;
        }
        new Thread(() -> {
            String failure = null;
            try {
                write(resolver, where, ready);
            } catch (Exception | OutOfMemoryError e) {
                failure = reason(e);
                // A file that was started and not finished is not a backup.
                discard(resolver, where);
            }
            ready.delete();
            final String why = failure;
            runOnUiThread(() -> tellPage("hardLinesBackupSaved",
                    why == null ? "true,\"\"" : "false," + JSONObject.quote(why)));
        }, "backup-write").start();
    }

    /**
     * The whole of one file into another place, replacing whatever was there.
     *
     * "wt" asks for the old contents to be cut off first, which matters when
     * the person chose to save over a longer file: without it the tail of the
     * old one is left on the end of the new one. Not every place a file can
     * be kept understands the request, so where it is refused the file is
     * opened plainly instead — which is right for a file the chooser has just
     * created, the ordinary case.
     */
    private static void write(ContentResolver resolver, Uri where, File from) throws IOException {
        OutputStream out;
        try {
            out = resolver.openOutputStream(where, "wt");
        } catch (IOException | RuntimeException unsupported) {
            out = resolver.openOutputStream(where, "w");
        }
        if (out == null) throw new IOException("the file could not be opened");
        try (OutputStream file = out; InputStream in = new FileInputStream(from)) {
            copy(in, file, Long.MAX_VALUE);
            file.flush();
        }
    }

    /** Everything from one stream into another, a little at a time — and no more than `limit` of it. */
    private static void copy(InputStream in, OutputStream out, long limit) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        long total = 0;
        int read;
        while ((read = in.read(buffer)) != -1) {
            total += read;
            if (total > limit) throw new IOException("the file is too large to be a backup");
            out.write(buffer, 0, read);
        }
    }

    /** Remove a file the chooser made and nothing good was put in. */
    private static void discard(ContentResolver resolver, Uri where) {
        try {
            DocumentsContract.deleteDocument(resolver, where);
        } catch (Exception | Error leftBehind) {
            // It stays, empty or part-written. The page says the save failed.
        }
    }

    /** The chooser has said which file to restore from — or none. */
    private void readBackup(@Nullable Uri which) {
        if (which == null) {
            tellPage("hardLinesRestoreCancelled", "");
            return;
        }
        final ContentResolver resolver = getContentResolver();
        final File waiting;
        final int turn;
        synchronized (files) {
            // Whatever was waiting from an earlier choice is not what was chosen now.
            restoreIn.discard();
            waiting = restoreIn.file();
            turn = ++restoreTurn;
        }
        new Thread(() -> {
            // Copied into the app first, and given its name only once it is
            // all there: the page collects it from here, and if the app is
            // restarted underneath the chooser it is still here when the page
            // comes back up and asks.
            final File part = new File(waiting.getPath() + "." + turn + ".part");
            String failure = null;
            boolean overtaken = false;
            try (InputStream in = resolver.openInputStream(which)) {
                if (in == null) throw new IOException("the file could not be opened");
                try (OutputStream out = new FileOutputStream(part)) {
                    copy(in, out, RESTORE_LIMIT);
                    out.flush();
                }
                synchronized (files) {
                    // Another file was chosen while this one was coming in:
                    // that one is the answer, and this one says nothing.
                    if (turn != restoreTurn) overtaken = true;
                    else if (!part.renameTo(waiting)) throw new IOException("the file could not be taken in");
                }
            } catch (Exception | OutOfMemoryError e) {
                failure = reason(e);
            }
            if (failure != null || overtaken) part.delete();
            if (overtaken) return;
            final String why = failure;
            runOnUiThread(() -> {
                if (why != null) {
                    tellPage("hardLinesRestoreFailed", JSONObject.quote(why));
                    return;
                }
                tellPage("hardLinesRestoreReady", "");
            });
        }, "backup-read").start();
    }

    /** One @font-face rule, pointing at a file bundled in assets/fonts/. */
    private static String face(String family, int weight, String file) {
        return "@font-face{font-family:'" + family + "';font-style:normal;font-weight:" + weight
                + ";font-display:swap;src:url(https://" + DOMAIN + "/assets/fonts/" + file
                + ".woff2) format('woff2')}\n";
    }

    /**
     * The stylesheet the page's &lt;link&gt; asks for, rewritten to point at
     * the faces bundled in assets/fonts/. Those URLs are on the page's own
     * origin, so the font requests are same-origin and need no CORS headers.
     */
    private WebResourceResponse fontStylesheet() {
        // Kept in step with the <link> in src/head.html and with
        // tests/android-assets-test.cjs, which drives the page exactly this way.
        StringBuilder css = new StringBuilder();
        for (int weight : new int[] {400, 500, 600, 700}) css.append(face("Inter", weight, "inter-" + weight));
        for (int weight : new int[] {400, 600}) css.append(face("JetBrains Mono", weight, "jetbrains-mono-" + weight));
        InputStream body = new ByteArrayInputStream(css.toString().getBytes(StandardCharsets.UTF_8));
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/css", "utf-8", 200, "OK", headers, body);
    }

    /**
     * One file from the APK's assets, served as the given type — or null when
     * there is no such file, so the caller falls through to the loader and its
     * ordinary 404 rather than answering with an empty body that looks like a
     * file.
     */
    @Nullable
    private WebResourceResponse asset(String name, String mimeType) {
        try {
            InputStream body = getAssets().open(name);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(mimeType, null, 200, "OK", headers, body);
        } catch (IOException missing) {
            return null;
        }
    }

    /**
     * Dark icons on the light theme, light icons on the dark one. Without it
     * the clock and the battery are white on bone in daylight.
     */
    private void applyBarIconContrast() {
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        WindowInsetsControllerCompat bars =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(!night);
        bars.setAppearanceLightNavigationBars(!night);
    }

    /**
     * The activity is not recreated when the phone rotates or the system
     * switches to dark (see android:configChanges in the manifest) —
     * recreating it would reload the page and lose whatever game was on the
     * board. The things that actually needed doing on a change are done here.
     */
    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyBarIconContrast();
        int page = getColor(R.color.page);
        if (root != null) root.setBackgroundColor(page);
        if (web != null) web.setBackgroundColor(page);
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onPause() {
        // THE MOMENT TO REFRESH THE APP'S OWN COPY. Whatever was done in the
        // app has been done, and from here on the phone may stop it without
        // another word. The page is asked before it is paused; it also hears
        // for itself that it has been hidden, and makes the copy only once.
        tellPage("hardLinesLeaving", "");

        // The engine searches on a timer. Left running behind a locked screen
        // it is a phone that gets warm in a pocket for no reason.
        if (web != null) {
            web.onPause();
            web.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.resumeTimers();
            web.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
