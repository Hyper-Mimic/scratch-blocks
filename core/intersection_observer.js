'use strict';

goog.provide('Blockly.IntersectionObserver');

Blockly.IntersectionObserver = function(workspace) {
  this.workspace = workspace;
  this.observing = [];
  this.intersectionCheckQueued = false;
  // PATCH 12 (2026-10-10): the per-block rectangles are no longer cached here.
  // They live on the workspace (see refreshContentRects_), shared with
  // getBlocksBoundingBox, so the culling pass and the scrollbar bounds can never
  // disagree and a single re-rendered stack is measured once instead of twice.
  // contentDirty_ means "ask the workspace to refresh its table before reading".
  this.contentDirty_ = true;
  // Stacks that came back into view and still owe a render. They are rendered
  // together at the end of the pass so the workspace resizes once.
  this.pendingRenders_ = [];
  this.checkForIntersections = this.checkForIntersections.bind(this);
};

/**
 * Distance, in screens, beyond the viewport at which an already culled stack is
 * moved out of the document. Two screens is far enough that ordinary scrolling
 * never reaches the boundary while the gap to the visible test (12 * scale)
 * provides the hysteresis.
 * @const {number}
 */
Blockly.IntersectionObserver.UNLOAD_SCREENS = 2;

/**
 * Upper bound on how many stacks one frame may unload. Jumping to a far corner
 * can put hundreds of stacks over the threshold at once, and doing them all in a
 * single frame is a long task exactly when the user asked for a smooth frame.
 * @const {number}
 */
Blockly.IntersectionObserver.MAX_UNLOAD_PER_FRAME = 30;

/**
 * Counters for profiling, mirrored onto window.__cullingStats. Kept in one
 * reused object so a per-frame update does not allocate.
 */
Blockly.IntersectionObserver.stats = {
  frames: 0,
  lastMs: 0,
  culled: 0,
  unloaded: 0,
  restored: 0
};

Blockly.IntersectionObserver.prototype.observe = function(block) {
  // PATCH 13 (2026-10-10): keep an O(1) membership index beside the array, which
  // stays because the culling pass depends on its iteration order. Deleting a
  // deep stack used to cost O(observing) per disposed block just to find out it
  // was not observed at all (only top blocks are).
  if (!this.observingSet_) {
    this.observingSet_ = new Set();
  }
  if (!this.observingSet_.has(block)) {
    this.observingSet_.add(block);
    this.observing.push(block);
    // PATCH 11 (2026-10-10): membership changed -> cached rects are stale.
    this.contentDirty_ = true;
  }
};

Blockly.IntersectionObserver.prototype.unobserve = function(block) {
  if (this.observingSet_) {
    if (!this.observingSet_.delete(block)) {
      return;
    }
  } else if (this.observing.indexOf(block) === -1) {
    return;
  }
  this.observing = this.observing.filter(function(i) {
    return i !== block;
  });
  // PATCH 11 (2026-10-10): membership changed -> cached rects are stale.
  this.contentDirty_ = true;
};

Blockly.IntersectionObserver.prototype.dispose = function() {
  this.observing = [];
  this.observingSet_ = null;
  this.pendingRenders_ = [];
  this.workspace = null;
};

Blockly.IntersectionObserver.prototype.queueIntersectionCheck = function() {
  if (this.intersectionCheckQueued) {
    return;
  }
  this.intersectionCheckQueued = true;
  // PATCH 8 (2026-09-26): coalesce onto an animation frame. A microtask drains
  // many times per painted frame, so a burst of drag/scroll events ran the full
  // O(blocks) check repeatedly within one frame; rAF collapses all of them into
  // a single check per frame.
  if (window.requestAnimationFrame) {
    window.requestAnimationFrame(this.checkForIntersections);
    return;
  }
  // Check for intersections on the next microtick
  // Prefer to use the native method when available, otherwise fallback to a Promise-based polyfill
  if (window.queueMicrotask) {
    window.queueMicrotask(this.checkForIntersections);
  } else {
    // eslint-disable-next-line no-undef
    Promise.resolve().then(this.checkForIntersections);
  }
};

/**
 * Whether this pass may move culled stacks out of the document. These are the
 * per-workspace conditions; per-stack ones are checked in the loop.
 * @return {boolean}
 * @private
 */
Blockly.IntersectionObserver.prototype.canUnloadStacks_ = function() {
  var workspace = this.workspace;
  if (!workspace || !workspace.viewportCullingEnabled_) {
    return false;
  }
  // A flyout keeps its blocks in the document on purpose: it inserts background
  // rectangles relative to them and measures itself with getBBox(), which only
  // counts attached nodes. A mutator does the same. Both keep the display:none
  // culling that happens before this gate.
  if (workspace.isFlyout || workspace.isMutator) {
    return false;
  }
  // A hidden workspace has no meaningful text measurements, and its size
  // attributes can collapse, which would make everything look offscreen.
  if (workspace.isVisible && !workspace.isVisible()) {
    return false;
  }
  // Never move stacks while the user is moving one.
  if (workspace.isMovingBlocks_ && workspace.isMovingBlocks_()) {
    return false;
  }
  // An open field editor or dropdown is positioned from the block's bounding
  // client rect, which is empty for a node outside the document.
  if (Blockly.DropDownDiv && Blockly.DropDownDiv.isVisible &&
      Blockly.DropDownDiv.isVisible()) {
    return false;
  }
  if (Blockly.WidgetDiv && Blockly.WidgetDiv.isVisible &&
      Blockly.WidgetDiv.isVisible()) {
    return false;
  }
  return true;
};

Blockly.IntersectionObserver.prototype.checkForIntersections = function() {
  this.intersectionCheckQueued = false;

  if (!this.workspace) {
    return;
  }

  var hasPerformance = typeof performance !== 'undefined' && !!performance.now;
  var startTime = hasPerformance ? performance.now() : Date.now();

  var workspace = this.workspace;
  var workspaceScale = workspace.scale;
  var workspaceHeight = workspace.getParentSvg().height.baseVal.value;
  var workspaceWidth = workspace.getParentSvg().width.baseVal.value;
  if (workspace.isDragSurfaceActive_) {
    var canvasPos = Blockly.utils.getRelativeXY(workspace.workspaceDragSurface_.SVG_);
  } else {
    var canvasPos = Blockly.utils.getRelativeXY(workspace.getCanvas());
  }

  // Allow blocks to go slightly offscreen so that effects such as glow do not get cut off.
  var margin = 12 * workspaceScale;

  // PATCH 8 GUARD (2026-09-26): never cull the block that is currently being
  // dragged. The dragged block lives on the block drag surface while a drag is
  // in flight; getCurrentBlock() returns dragGroup_.firstChild, i.e. the node
  // passed to setBlocksAndShow(getSvgRoot()), so comparing node identity skips
  // exactly it and leaves every other block's culling untouched.
  var draggedNode = null;
  var blockDragSurface = workspace.blockDragSurface_;
  if (blockDragSurface && typeof blockDragSurface.getCurrentBlock === 'function') {
    draggedNode = blockDragSurface.getCurrentBlock() || null;
  }

  // PATCH 12 (2026-10-10): read the rectangles off the workspace's shared table
  // instead of re-measuring every stack here. The table is refreshed lazily and
  // incrementally, and usually already up to date because the same content
  // change that queued this check also made the workspace recompute its bounds.
  if (this.contentDirty_) {
    workspace.refreshContentRects_();
    this.contentDirty_ = false;
  }
  var rects = workspace.contentRectCache_;

  // Viewport culling (2026-10-23): culled stacks may additionally be moved out
  // of the document. The decision needs a couple of workspace-wide conditions,
  // so they are evaluated once per pass rather than per block. A zero-sized or
  // unscaled workspace would make the distance below infinite, so it is excluded
  // here rather than guarded twice.
  var canUnload = this.canUnloadStacks_() &&
      workspaceWidth > 0 && workspaceHeight > 0 && workspaceScale > 0;
  var canvas = workspace.getCanvas();
  var selectedRoot = null;
  if (Blockly.selected && Blockly.selected.workspace === workspace) {
    selectedRoot = Blockly.selected.getRootBlock();
  }
  var unloadDistance = Blockly.IntersectionObserver.UNLOAD_SCREENS;
  var candidates = null;
  var culledCount = 0;
  var unloadedCount = 0;
  var restoredCount = 0;

  for (var i = 0; i < this.observing.length; i++) {
    var block = this.observing[i];

    // The DOM is the source of truth for the unloaded flag. If anything moved or
    // removed the root behind our back (a drop, a dispose, a cancelled unload),
    // drop the stale flag and its anchor here, so a missed restore path costs one
    // frame instead of a block that never comes back.
    block.repairUnloadedState_();

    if (draggedNode && block.getSvgRoot() === draggedNode) {
      block.setIntersects(true);
      continue;
    }

    var rect = rects && rects.get(block);
    if (!rect) {
      // Safety net: an observed block the workspace table has not seen yet.
      // Measure it now and hand the result to the table for later frames.
      // Mirrors BlockSvg.getBoundingRectangle, hat overhang included.
      var pos = block.getRelativeToSurfaceXY();
      var size = block.getHeightWidth();
      var hatOverhang = block.getTopOverhang_();
      rect = {
        left: block.RTL ? pos.x - size.width : pos.x,
        top: pos.y - hatOverhang,
        width: size.width,
        height: size.height + hatOverhang
      };
      if (rects) {
        rects.set(block, rect);
      }
    }

    // rect.left already carries the RTL shift that this pass used to apply by
    // hand: BlockSvg.getBoundingRectangle() subtracts the width in RTL, exactly
    // like the old `if (RTL) blockPosX -= blockWidth`.
    var blockPosX = rect.left * workspaceScale;
    var blockPosY = rect.top * workspaceScale;
    var blockWidth = rect.width * workspaceScale;
    var blockHeight = rect.height * workspaceScale;

    var visible = true;
    if (canvasPos.y + blockPosY - margin > workspaceHeight) {
      visible = false;
    } else if (canvasPos.x + blockPosX - margin > workspaceWidth) {
      visible = false;
    } else if (canvasPos.x + blockPosX + blockWidth + margin < 0) {
      visible = false;
    } else if (canvasPos.y + blockPosY + blockHeight + margin < 0) {
      visible = false;
    }

    var wasIntersecting = block.intersects_;
    block.setIntersects(visible);

    if (visible) {
      if (!wasIntersecting) {
        restoredCount++;
      }
      // A restored block may owe a render: its fields could have been edited
      // while it was out of the document (see BlockSvg.render).
      if (block.needsRenderOnReload_) {
        this.pendingRenders_.push(block);
      }
      continue;
    }

    if (wasIntersecting) {
      culledCount++;
    }

    // Offscreen. Only stacks that sit directly on the canvas can leave it: the
    // drag surface, a parent block and a flyout all need the node in place.
    if (!canUnload || block.unloaded_ || block === selectedRoot) {
      continue;
    }
    var root = block.getSvgRoot();
    if (!root || root.parentNode !== canvas) {
      continue;
    }

    // Distance from the viewport in screens, normalised per axis and then
    // maximised. Dividing by the axis that was exceeded keeps a wide, short
    // viewport from refusing to unload anything above or below it.
    var left = canvasPos.x + blockPosX;
    var top = canvasPos.y + blockPosY;
    var gapX = Math.max(0, left - workspaceWidth, -left - blockWidth);
    var gapY = Math.max(0, top - workspaceHeight, -top - blockHeight);
    var distance = Math.max(gapX / workspaceWidth, gapY / workspaceHeight);
    if (distance > unloadDistance) {
      if (!candidates) {
        candidates = [];
      }
      candidates.push({block: block, distance: distance});
    }
  }

  // Unload the furthest stacks first, within the per-frame budget, so the next
  // frame already has less work to do.
  if (candidates) {
    if (candidates.length > 1) {
      candidates.sort(function(a, b) {
        return b.distance - a.distance;
      });
    }
    var limit = Math.min(candidates.length,
        Blockly.IntersectionObserver.MAX_UNLOAD_PER_FRAME);
    for (var c = 0; c < limit; c++) {
      candidates[c].block.setUnloaded_(true);
      if (candidates[c].block.unloaded_) {
        unloadedCount++;
      }
    }
  }

  // Blocks that came back owe a render, because their fields may have changed
  // while they were out of the document. Batch it: render() resizes the content,
  // and one resize per restored stack rebuilds the scrollbars that many times.
  if (this.pendingRenders_.length) {
    var pending = this.pendingRenders_;
    workspace.beginContentUpdate_();
    try {
      for (var p = 0; p < pending.length; p++) {
        var restoredBlock = pending[p];
        if (!restoredBlock.workspace || !restoredBlock.needsRenderOnReload_) {
          continue;
        }
        restoredBlock.needsRenderOnReload_ = false;
        restoredBlock.render();
      }
    } finally {
      workspace.endContentUpdate_();
    }
    pending.length = 0;
  }

  var stats = Blockly.IntersectionObserver.stats;
  stats.frames++;
  stats.culled = culledCount;
  stats.unloaded = unloadedCount;
  stats.restored = restoredCount;
  stats.lastMs = (hasPerformance ? performance.now() : Date.now()) - startTime;
  if (typeof window !== 'undefined') {
    window.__cullingStats = stats;
  }
};
