# -*- coding: utf-8 -*-
"""
PATCH 8 (2026-09-26): block culling -- always-on coalescing + drag guard.

Applies to the prebuilt blockly_compressed_vertical.js / _horizontal.js, which
are what an embedding project actually loads. The readable core/ sources are
mirrored by hand (core/block_dragger.js, core/intersection_observer.js).

Why: with tens of thousands of blocks the editor drops frames while dragging a
block. Two independent causes, both fixed here:
  (a) BlockDragger.dragBlock never asked the intersection observer to re-run,
      so a dragged block's chain was never culled/unculled while moving.
  (b) The check was coalesced onto a microtask, which drains many times per
      painted frame -- a burst of drag events ran the full O(blocks) check
      repeatedly within one frame.

What:
  (a) queue a coalesced intersection check from dragBlock.
  (b) coalesce the check onto requestAnimationFrame instead of a microtask, so
      all events within one frame collapse into a single check (rAF runs once).
  (c) never cull the block that is currently being dragged. (a) makes the check
      run every frame, and the check measures against the *workspace viewport* --
      but a block can be legitimately dragged outside it, e.g. up over the
      backpack / sprite panes that sit beside the workspace column. Without the
      guard the dragged block is judged off-screen and gets display:none, so it
      vanishes from under the cursor.
      The dragged block lives on the block drag surface while the drag is in
      flight, and getCurrentBlock() returns dragGroup_.firstChild -- the very
      node setBlocksAndShow() was handed, i.e. the block's getSvgRoot(). So the
      guard is a plain identity comparison.

These three are unconditional: the earlier design gated everything behind
`window.__hmBlockCulling` and detached nodes from the DOM, but the DOM-detach
half was abandoned (it could not restore visibility for blocks that were
unplugged while detached, and it broke getRelativeToSurfaceXY() for anything
dragged). The culling itself already shipped; what remains is the perf
coalescing plus the drag guard, and neither needs a switch.

Idempotent: if a hunk's NEW text is already present it is skipped; if neither old
nor new is found it warns but does not abort.
"""

import io
import sys

BASE = r"F:/ClyainBackup/HyperMimic/scratch-blocks"


# ---------------------------------------------------------------------------
# The hunks, written once and applied to every compressed flavour. The vertical
# and horizontal builds share these exact minified forms.
# ---------------------------------------------------------------------------
HUNKS = [
    # (a) BlockDragger.dragBlock: queue an intersection check right after dragIcons_
    (
        r"""BlockDragger.prototype.dragBlock=function(a,b){b=this.pixelsToWorkspaceUnits_(b);var c=goog.math.Coordinate.sum(this.startXY_,b);this.draggingBlock_.moveDuringDrag(c);this.dragIcons_(b);this.deleteArea_=this.workspace_.isDeleteArea(a);""",
        r"""BlockDragger.prototype.dragBlock=function(a,b){b=this.pixelsToWorkspaceUnits_(b);var c=goog.math.Coordinate.sum(this.startXY_,b);this.draggingBlock_.moveDuringDrag(c);this.dragIcons_(b);this.workspace_.queueIntersectionCheck&&this.workspace_.queueIntersectionCheck();this.deleteArea_=this.workspace_.isDeleteArea(a);"""
    ),
    # (b) IntersectionObserver.queueIntersectionCheck: coalesce on rAF, not a microtask
    (
        r"""Blockly.IntersectionObserver.prototype.queueIntersectionCheck=function(){this.intersectionCheckQueued||(this.intersectionCheckQueued=!0,window.queueMicrotask?window.queueMicrotask(this.checkForIntersections):Promise.resolve().then(this.checkForIntersections))};""",
        r"""Blockly.IntersectionObserver.prototype.queueIntersectionCheck=function(){if(!this.intersectionCheckQueued){this.intersectionCheckQueued=!0,window.requestAnimationFrame?window.requestAnimationFrame(this.checkForIntersections):window.queueMicrotask?window.queueMicrotask(this.checkForIntersections):Promise.resolve().then(this.checkForIntersections)}};"""
    ),
    # (c1) checkForIntersections: capture the dragged node BEFORE `a` gets reused
    #      as the canvas-position variable below, then read it in the loop.
    (
        r"""Blockly.IntersectionObserver.prototype.checkForIntersections=function(){this.intersectionCheckQueued=!1;if(this.workspace){var a=this.workspace,b=a.scale,""",
        r"""Blockly.IntersectionObserver.prototype.checkForIntersections=function(){this.intersectionCheckQueued=!1;if(this.workspace){var a=this.workspace,hmDragNode=a.blockDragSurface_&&a.blockDragSurface_.getCurrentBlock?a.blockDragSurface_.getCurrentBlock():null,b=a.scale,"""
    ),
    # (c2) checkForIntersections: skip the dragged block in the observing loop
    (
        r"""for(var f=12*b,g=0;g<this.observing.length;g++){var h=this.observing[g],k=h.getRelativeToSurfaceXY(),l=null;""",
        r"""for(var f=12*b,g=0;g<this.observing.length;g++){var h=this.observing[g];if(hmDragNode&&hmDragNode===h.getSvgRoot()){h.setIntersects(!0);continue}var k=h.getRelativeToSurfaceXY(),l=null;"""
    ),
]


# Each hunk's own unique marker, used for the idempotency check. A hunk's NEW
# text cannot be used directly: several hunks embed another hunk's OLD text, so
# `new in src` would match on the second run and the hunk would be applied twice.
# These markers only exist once that specific hunk has been applied.
MARKERS = {
    1: "this.workspace_.queueIntersectionCheck&&this.workspace_.queueIntersectionCheck()",
    2: "window.requestAnimationFrame?window.requestAnimationFrame(this.checkForIntersections)",
    3: "hmDragNode=a.blockDragSurface_&&a.blockDragSurface_.getCurrentBlock",
    4: "if(hmDragNode&&hmDragNode===h.getSvgRoot()){h.setIntersects(!0);continue}",
}


def marker_of(index):
    return MARKERS[index]


def patch(path):
    with io.open(path, "r", encoding="utf-8", newline="") as fh:
        src = fh.read()

    applied = skipped = missing = 0
    for i, (old, new) in enumerate(HUNKS, 1):
        if marker_of(i) in src:
            # Already applied. Checked first so hunks whose OLD text survives
            # inside another hunk's NEW text cannot be applied twice.
            skipped += 1
        elif old in src:
            src = src.replace(old, new, 1)
            applied += 1
        else:
            missing += 1
            sys.stderr.write("  hunk %d: neither old nor new found -- skipped.\n" % i)

    # newline="" above / below keeps the file's existing line endings intact
    # instead of letting Python rewrite every "\n" as "\r\n" on write.
    with io.open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(src)

    sys.stderr.write(
        "%s: %d applied, %d already applied, %d missing\n"
        % (path.rsplit("/", 1)[-1], applied, skipped, missing)
    )
    return missing


def main():
    files = [
        BASE + "/blockly_compressed_vertical.js",
        BASE + "/blockly_compressed_horizontal.js",
    ]
    total_missing = 0
    for path in files:
        total_missing += patch(path)
    if total_missing:
        sys.stderr.write("WARNING: %d hunks missing across all files.\n" % total_missing)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
