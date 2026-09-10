package app.yatraflow.mobile;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Android apps never draw a page scrollbar — the finger IS the scroll
    // indicator. The WebView turns its on both by default, which showed as a
    // thick bar hugging the right edge of every screen in the app.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        // No scrollbar thumb, no fading edge, no over-scroll glow: scroll
        // becomes pure content motion, like a native view.
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setScrollbarFadingEnabled(true);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
    }
}
