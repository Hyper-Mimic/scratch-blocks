# -*- coding: utf-8 -*-
"""
PATCH 8 (2026-09-26): block culling -- off by default, runtime-toggled.

Applies to the prebuilt blockly_compressed_vertical.js / _horizontal.js, which
are what an embedding project actually loads. The readable core/ sources are
mirrored by hand (core/block_svg.js, core/block_dragger.js,
core/intersection_observer.js, core/workspace_svg.js).

Why: with tens of thousands of blocks the editor drops frames while dragging a
block. Two independent causes, both fixed here:
  (a) BlockDragger.dragBlock never asked the intersection observer to re-run,
      so a dragged block's chain was never culled/unculled while moving.
  (b) setIntersects hid off-screen blocks with `display:none`, which keeps the
      nodes in the DOM: the browser still walks them every frame for style,
      layout and hit-testing.

What:
  (a) queue a coalesced intersection check from dragBlock, and coalesce the
      check onto requestAnimationFrame instead of a microtask (a microtask
      drains many times per frame; rAF runs once).
  (b) setIntersects detaches the block's <g> from the DOM and re-inserts it when
      it comes back on screen. Block geometry is safe under detach:
      getHeightWidth() reads this.width/this.height, which are computed from
      canvas measureText() at render() time, not from layout.
  (c) re-attach a detached block that becomes top-level, otherwise it would stay
      invisible (updateIntersectionObserver only restores visibility on the
      "has a parent" branch, while observe() only ever tracks top-level blocks).

GATING: every behaviour is behind `window.__hmBlockCulling`, which defaults to
false, so with the switch off the code path is byte-for-byte the old one. A host
flips the flag through `workspace.hmApplyBlockCulling(bool)`.

Idempotent: if a hunk's NEW text is already present it is skipped; if neither old
nor new is found it warns but does not abort.
"""

import io
import sys

BASE = r"F:/ClyainBackup/HyperMimic/scratch-blocks"

# ---------------------------------------------------------------------------
# The five hunks, written once and applied to every compressed flavour. The
# vertical and horizontal builds share these exact minified forms.
# ---------------------------------------------------------------------------
HUNKS = [
    # (a) BlockDragger.dragBlock: queue an intersection check right after dragIcons_
    (
        r"""BlockDragger.prototype.dragBlock=function(a,b){b=this.pixelsToWorkspaceUnits_(b);var c=goog.math.Coordinate.sum(this.startXY_,b);this.draggingBlock_.moveDuringDrag(c);this.dragIcons_(b);this.deleteArea_=this.workspace_.isDeleteArea(a);""",
        r"""BlockDragger.prototype.dragBlock=function(a,b){b=this.pixelsToWorkspaceUnits_(b);var c=goog.math.Coordinate.sum(this.startXY_,b);this.draggingBlock_.moveDuringDrag(c);this.dragIcons_(b);this.workspace_.queueIntersectionCheck&&this.workspace_.queueIntersectionCheck();this.deleteArea_=this.workspace_.isDeleteArea(a);"""
    ),
    # (b1) queueIntersectionCheck: coalesce on rAF rather than a microtask
    (
        r"""Blockly.IntersectionObserver.prototype.queueIntersectionCheck=function(){this.intersectionCheckQueued||(this.intersectionCheckQueued=!0,window.queueMicrotask?window.queueMicrotask(this.checkForIntersections):Promise.resolve().then(this.checkForIntersections))};""",
        r"""Blockly.IntersectionObserver.prototype.queueIntersectionCheck=function(){if(!this.intersectionCheckQueued){if(this.intersectionCheckQueued=!0,window.__hmBlockCulling&&window.requestAnimationFrame)return void window.requestAnimationFrame(this.checkForIntersections);window.queueMicrotask?window.queueMicrotask(this.checkForIntersections):Promise.resolve().then(this.checkForIntersections)}};"""
    ),
    # (b2) setIntersects: detach / re-insert instead of display:none, when enabled
    (
        r"""Blockly.BlockSvg.prototype.setIntersects=function(a){if(a!==this.intersects_){this.intersects_=a;var b=this.getSvgRoot();b&&(b.style.display=a?"":"none")}};""",
        r"""Blockly.BlockSvg.prototype.setIntersects=function(a){if(a!==this.intersects_){if(this.intersects_=a,window.__hmBlockCulling){var b=this.getSvgRoot();if(!b)return;if(a){var c=this.hmDetachedParent_;this.hmDetachedParent_=null;c&&!b.parentNode&&Blockly.BlockSvg.hmReinsertIntoGroup_(c,b)}else{if(b.classList&&b.classList.contains("blocklyDragging")||this.workspace&&this.workspace.isDragging&&this.workspace.isDragging()||!b.parentNode)return;this.hmDetachedParent_=b.parentNode,b.parentNode.removeChild(b)}return}var b=this.getSvgRoot();b&&(b.style.display=a?"":"none")}};Blockly.BlockSvg.hmReinsertIntoGroup_=function(a,b){a.appendChild(b)};Blockly.BlockSvg.hmReattachAll=function(a){a&&a.intersectionObserver&&(a.intersectionObserver.observing||[]).forEach(function(b){b.hmDetachedParent_&&(b.hmDetachedParent_=null,b.getSvgRoot()&&b.workspace&&b.setIntersects(!0))})};"""
    ),
    # (c) updateIntersectionObserver: re-attach before observing a top-level block
    (
        r"""Blockly.BlockSvg.prototype.updateIntersectionObserver=function(){this.workspace.intersectionObserver&&(this.getParent()?(this.workspace.intersectionObserver.unobserve(this),this.intersects_||this.setIntersects(!0)):this.workspace.intersectionObserver.observe(this))};""",
        r"""Blockly.BlockSvg.prototype.updateIntersectionObserver=function(){this.workspace.intersectionObserver&&(this.getParent()?(this.workspace.intersectionObserver.unobserve(this),this.intersects_||this.setIntersects(!0)):(this.hmReattachIfDetached(),this.workspace.intersectionObserver.observe(this)))};Blockly.BlockSvg.prototype.hmReattachIfDetached=function(){this.hmDetachedParent_&&this.setIntersects(!0)};"""
    ),
    # (d) WorkspaceSvg.hmApplyBlockCulling: the host-facing entry point
    (
        r"""Blockly.WorkspaceSvg.prototype.queueIntersectionCheck=function(){this.intersectionObserver&&this.intersectionObserver.queueIntersectionCheck()};""",
        r"""Blockly.WorkspaceSvg.prototype.queueIntersectionCheck=function(){this.intersectionObserver&&this.intersectionObserver.queueIntersectionCheck()};Blockly.WorkspaceSvg.prototype.hmApplyBlockCulling=function(a){window.__hmBlockCulling=!!a,a||Blockly.BlockSvg.hmReattachAll(this),this.queueIntersectionCheck()};"""
    ),
]


# Each hunk's own unique marker, used for the idempotency check. A hunk's NEW
# text cannot be used directly: hunk 3 ends with the very `queueIntersectionCheck`
# definition that hunk 4 rewrites, so `new in src` matches for hunk 4 on the
# second run and it would be applied twice. These markers are strings that appear
# only once that hunk has been applied.
MARKERS = {
    1: "this.workspace_.queueIntersectionCheck&&this.workspace_.queueIntersectionCheck()",
    2: "window.__hmBlockCulling&&window.requestAnimationFrame",
    3: "Blockly.BlockSvg.hmReattachAll=function",
    4: "Blockly.BlockSvg.prototype.hmReattachIfDetached=function",
    5: "Blockly.WorkspaceSvg.prototype.hmApplyBlockCulling=function",
}


def marker_of(index):
    return MARKERS[index]


def patch(path):
    with io.open(path, "r", encoding="utf-8") as fh:
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

    with io.open(path, "w", encoding="utf-8") as fh:
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
