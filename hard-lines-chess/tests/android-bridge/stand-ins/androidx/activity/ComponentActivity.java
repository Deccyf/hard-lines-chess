package androidx.activity;
import androidx.activity.result.*;
import androidx.activity.result.contract.*;
import java.util.*;
public class ComponentActivity extends android.app.Activity {
    public final List<ActivityResultLauncher<?>> choosers = new ArrayList<>();
    private boolean created = false;
    @Override protected void onCreate(android.os.Bundle b) { created = true; }
    public final OnBackPressedDispatcher getOnBackPressedDispatcher() { return new OnBackPressedDispatcher(); }
    public final <I, O> ActivityResultLauncher<I> registerForActivityResult(ActivityResultContract<I, O> contract, ActivityResultCallback<O> callback) {
        if (!created) throw new IllegalStateException("registered before onCreate");
        ActivityResultLauncher<I> launcher = new ActivityResultLauncher<>(contract, callback);
        choosers.add(launcher);
        return launcher;
    }
}
