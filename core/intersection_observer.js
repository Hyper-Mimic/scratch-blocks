'use strict';

goog.provide('Blockly.IntersectionObserver');

Blockly.IntersectionObserver = function(workspace) {
  this.workspace = workspace;
  this.observing = [];
  this.intersectionCheckQueued = false;
  this.checkForIntersections = this.checkForIntersections.bind(this);
};

Blockly.IntersectionObserver.prototype.observe = function(block) {
  var index = this.observing.indexOf(block);
  if (index === -1) {
    this.observing.push(block);
  }
};

Blockly.IntersectionObserver.prototype.unobserve = function(block) {
  var index = this.observing.indexOf(block);
  if (index !== -1) {
    this.observing = this.observing.filter(function(i) {
      return i !== block;
    });
  }
};

Blockly.IntersectionObserver.prototype.dispose = function() {
  this.observing = [];
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
  var RTL = workspace.RTL;
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
  // dragged.
  //
  // PATCH 8 makes this check run once per animation frame while a block drag is
  // in progress, so the culling around the dragged stack stays correct on very
  // large workspaces. But the check measures positions against the *workspace
  // viewport*, and the user can legitimately drag a block outside that viewport
  // -- e.g. up over the backpack / sprite panes, which sit beside the workspace
  // column. The dragged block would then be judged off-screen and get
  // display:none, so it vanished from under the cursor until it came back
  // inside.
  //
  // The dragged block lives on the block drag surface while the drag is in
  // flight; getCurrentBlock() returns dragGroup_.firstChild, which is the node
  // passed to setBlocksAndShow(getSvgRoot()), i.e. the same node
  // block.getSvgRoot() returns. Comparing against it skips exactly the dragged
  // block and leaves every other block's culling untouched.
  var draggedNode = null;
  var blockDragSurface = workspace.blockDragSurface_;
  if (blockDragSurface && typeof blockDragSurface.getCurrentBlock === 'function') {
    draggedNode = blockDragSurface.getCurrentBlock() || null;
  }

  for (var i = 0; i < this.observing.length; i++) {
    var block = this.observing[i];
    if (draggedNode && block.getSvgRoot() === draggedNode) {
      // Force it visible in case an earlier frame hid it before this guard existed.
      block.setIntersects(true);
      continue;
    }
    var blockPos = block.getRelativeToSurfaceXY();
    var blockSize = null;
    if (RTL) {
      blockSize = block.getHeightWidth();
      blockPos.x -= blockSize.width;
      blockSize.width *= workspaceScale;
      blockSize.height *= workspaceScale;
    }
    blockPos.x *= workspaceScale;
    blockPos.y *= workspaceScale;

    var visible = true;
    if (canvasPos.y + blockPos.y - margin > workspaceHeight) {
      visible = false;
    } else if (canvasPos.x + blockPos.x - margin > workspaceWidth) {
      visible = false;
    } else {
      if (!blockSize) {
        blockSize = block.getHeightWidth();
        blockSize.width *= workspaceScale;
        blockSize.height *= workspaceScale;
      }
      if (canvasPos.x + blockPos.x + blockSize.width + margin < 0) {
        visible = false;
      } else if (canvasPos.y + blockPos.y + blockSize.height + margin < 0) {
        visible = false;
      }
    }

    block.setIntersects(visible);
  }
};
