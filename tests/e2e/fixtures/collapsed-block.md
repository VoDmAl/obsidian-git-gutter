# Collapsed block fixture

This note exists only for `npm run test:e2e`. The suite rewrites it on disk and
restores it with `git checkout --` afterwards, so treat its contents as test
data rather than documentation.

The suite finds its lines by searching for the sentences below, not by line
number, so the file can grow without breaking the tests — but the marker text
must stay unique.

<p>
<strong>A multi-line raw HTML block.</strong><br>
Live Preview draws this whole block as one widget, which is exactly where the
gutter used to lose changes.<br>
THIRD LINE INSIDE THE BLOCK, the one the suite edits.<br>
Fourth line inside the block, so the edited line is neither first nor last.
</p>

PLAIN PARAGRAPH AFTER THE BLOCK, the control the suite edits second.
