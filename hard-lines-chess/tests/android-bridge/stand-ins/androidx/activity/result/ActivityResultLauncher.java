package androidx.activity.result;
import java.util.*;
/** A chooser: remembers what it was opened with, and answers when the test says what was picked. */
public class ActivityResultLauncher<I> {
    public final List<I> launched = new ArrayList<>();
    public final ActivityResultCallback<Object> callback;
    public final Object contract;
    public boolean missing = false;
    @SuppressWarnings("unchecked")
    public ActivityResultLauncher(Object contract, ActivityResultCallback<?> callback) {
        this.contract = contract;
        this.callback = (ActivityResultCallback<Object>) callback;
    }
    public void launch(I input) {
        if (missing) throw new RuntimeException("No Activity found to handle Intent");
        launched.add(input);
    }
    public void answer(Object result) { callback.onActivityResult(result); }
}
