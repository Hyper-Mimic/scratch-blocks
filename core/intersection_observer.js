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
  this.checkForIntersections = this.checkForIntersections.bind(this);
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

Blockly.IntersectionObserver.prototype.checkForIntersections = function() {
  this.intersectionCheckQueued = false;

  if (!this.workspace) {
    return;
  }

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

  for (var i = 0; i < this.observing.length; i++) {
    var block = this.observing[i];
    if (draggedNode && block.getSvgRoot() === draggedNode) {
      block.setIntersects(true);
      continue;
    }

    var rect = rects && rects.get(block);
    if (!rect) {
      // Safety net: an observed block the workspace table has not seen yet.
      // Measure it now and hand the result to the table for later frames.
      var pos = block.getRelativeToSurfaceXY();
      var size = block.getHeightWidth();
      rect = {
        left: block.RTL ? pos.x - size.width : pos.x,
        top: pos.y,
        width: size.width,
        height: size.height
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

    block.setIntersects(visible);
  }
};
