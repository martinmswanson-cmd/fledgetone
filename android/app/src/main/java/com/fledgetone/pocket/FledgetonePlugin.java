package com.fledgetone.pocket;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * The app's own small native pieces (src/native/nativeApp.ts calls them):
 * - openSettings: the app's page in the phone's settings, where a microphone refused for good
 *   can be allowed again.
 * - takeOpenedFile: a project file opened in Fledgetone from another app (a file manager's
 *   "Open with", or "Share"), copied through the phone's content resolver into the app's cache
 *   (a song with recordings can be large: it goes file to file, never all in memory here), and
 *   the web side reads the copy. The event "fileOpened" says one has arrived; the web side then
 *   takes it (once).
 */
@CapacitorPlugin(name = "Fledgetone")
public class FledgetonePlugin extends Plugin {

    /** The largest project file read (bytes): a song with its recordings in it can be large. */
    private static final long MAX_FILE_BYTES = 200L * 1024 * 1024;

    private Uri openedFile = null;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        Uri uri = fileOf(intent);
        if (uri == null) return;
        synchronized (this) {
            openedFile = uri;
        }
        notifyListeners("fileOpened", new JSObject(), true);
    }

    /** The file an intent brings: "Open with" (its data), or "Share" (its stream). */
    private static Uri fileOf(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) return intent.getData();
        if (Intent.ACTION_SEND.equals(action)) {
            Object stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream instanceof Uri) return (Uri) stream;
        }
        return null;
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No settings page");
        }
    }

    @PluginMethod
    public void takeOpenedFile(PluginCall call) {
        Uri uri;
        synchronized (this) {
            uri = openedFile;
            openedFile = null;
        }
        JSObject ret = new JSObject();
        if (uri == null) {
            call.resolve(ret);
            return;
        }
        ret.put("name", nameOf(uri));
        File dir = new File(getContext().getCacheDir(), "opened");
        // (Only the newest is kept: the web side has read any earlier one)
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        if (!dir.isDirectory() && !dir.mkdirs()) {
            call.reject("Couldn't read the file: no room to copy it");
            return;
        }
        File copy = new File(dir, System.currentTimeMillis() + ".json");
        try (InputStream in = getContext().getContentResolver().openInputStream(uri); OutputStream out = new FileOutputStream(copy)) {
            if (in == null) throw new java.io.IOException("can't be read");
            byte[] buf = new byte[64 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_FILE_BYTES) {
                    out.close();
                    copy.delete();
                    call.reject("The file is too large to be a song");
                    return;
                }
                out.write(buf, 0, n);
            }
        } catch (Throwable e) {
            copy.delete();
            call.reject("Couldn't read the file: " + e.getMessage());
            return;
        }
        ret.put("path", copy.getAbsolutePath());
        call.resolve(ret);
    }

    /** The file's name as the app that holds it shows it, else the last part of its address. */
    private String nameOf(Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    String name = c.getString(0);
                    if (name != null) return name;
                }
            } catch (Exception e) {
                // Fall back to the address
            }
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "project.json";
    }
}
