package chess.hardlines;

import android.annotation.SuppressLint;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
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

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * The whole app is one HTML file in assets/. This is the window it opens in.
 *
 * THE APP HAS NO INTERNET PERMISSION, and that is a decision rather than an
 * oversight — see AndroidManifest.xml. Every request the page makes is
 * answered from the APK, so there is no state in which the app behaves
 * differently because a network was or was not there.
 */
public class MainActivity extends ComponentActivity {

    /**
     * WHY THE PAGE IS SERVED OVER https AND NOT LOADED AS A file:// URL.
     *
     * The trainer keeps every game, drill and setting in localStorage. A page
     * loaded from file:// has an opaque origin: its storage is unreliable, and
     * window.isSecureContext is false — which the page itself checks before it
     * will register anything. WebViewAssetLoader answers requests to this
     * reserved name from the APK's own assets, so the page runs on an ordinary
     * secure origin and its storage is ordinary storage that survives closing.
     */
    private static final String DOMAIN = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + DOMAIN + "/assets/index.html";

    /** The one host the page reaches for, and the one this answers locally. */
    private static final String FONT_CSS_HOST = "fonts.googleapis.com";

    /** How long a first back press stays counted, in milliseconds. */
    private static final long LEAVE_WINDOW = 2000L;

    private WebView web;
    private FrameLayout root;
    private long lastBackPress = 0L;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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
        // forgotten the moment the app closes.
        settings.setDomStorageEnabled(true);
        // Nothing is fetched, so nothing should be cached; the assets are the
        // cache. An HTTP cache layered over an APK asset can only ever serve
        // an older app than the one installed.
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

                WebResourceResponse local = loader.shouldInterceptRequest(url);
                if (local != null) return local;

                // ANYTHING ELSE IS REFUSED RATHER THAN FETCHED. Nothing in the
                // app asks for anything else; if something ever does, failing
                // here makes it visible instead of quietly giving an app whose
                // whole claim is that it needs no network a dependency on one.
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
     * The stylesheet the page's &lt;link&gt; asks for, rewritten to point at
     * the faces bundled in assets/fonts/. Those URLs are on the page's own
     * origin, so the font requests are same-origin and need no CORS headers.
     */
    private WebResourceResponse fontStylesheet() {
        String css =
                "@font-face{font-family:'Archivo Black';font-style:normal;font-weight:400;font-display:swap;"
                        + "src:url(https://" + DOMAIN + "/assets/fonts/archivo-black-400.woff2) format('woff2')}\n"
                + "@font-face{font-family:'Space Mono';font-style:normal;font-weight:400;font-display:swap;"
                        + "src:url(https://" + DOMAIN + "/assets/fonts/space-mono-400.woff2) format('woff2')}\n"
                + "@font-face{font-family:'Space Mono';font-style:normal;font-weight:700;font-display:swap;"
                        + "src:url(https://" + DOMAIN + "/assets/fonts/space-mono-700.woff2) format('woff2')}\n";
        InputStream body = new ByteArrayInputStream(css.getBytes(StandardCharsets.UTF_8));
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/css", "utf-8", 200, "OK", headers, body);
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
