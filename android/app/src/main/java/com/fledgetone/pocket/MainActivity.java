package com.fledgetone.pocket;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own native pieces (FledgetonePlugin.java), before the bridge starts
        registerPlugin(FledgetonePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
