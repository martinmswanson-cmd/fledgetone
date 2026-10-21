package com.fledgetone.pocket;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own native pieces (FledgetonePlugin.java), before the bridge starts
        registerPlugin(FledgetonePlugin.class);
        // Brought back after the phone closed it (or rebuilt it): the file it was opened with was
        // opened then, and opening it again would replace what's been done since
        if (savedInstanceState != null || (getIntent() != null && (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0)) {
            setIntent(new Intent(Intent.ACTION_MAIN));
        }
        super.onCreate(savedInstanceState);
    }
}
