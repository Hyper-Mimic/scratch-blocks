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
  // PATCH 19 (2026-11-06): restore is metered now, so a pass keeps two tables:
  // a stable pool of {block, priority} records that is never reallocated, and a
  // per-frame view over its first N entries. Nothing survives the pass: a stack
  // that does not get a slot stays display:none and simply re-enters the
  // visible branch on the next frame, so no cross-frame staleness can exist.
  this.restoreSlotPool_ = [];
  this.restoreCandidates_ = [];
  this.restoreBacklog_ = 0;
  // Watchdog for the frames this pass schedules for itself.
  this.autoContinueStalls_ = 0;
  // PATCH 21 (2026-11-07): tail-cull state. tailWindows_ caches the cut set of
  // each long stack against the workspace geometry generation; tailCulledBlocks_
  // is the set of roots currently in the offscreen layer because of a cut.
  this.tailWindows_ = new Map();
  this.tailCulledBlocks_ = new Set();
  this.tailDesired_ = [];
  this.tailDesiredSet_ = new Set();
  // PATCH 22: reused per-walk visit set. Blocks form a tree, but a stale
  // childBlocks_ entry must never be able to make the walk diverge.
  this.tailVisited_ = new Set();
  this.tailPending_ = false;
  // PATCH 25: per-pass walk profiling, reset at the top of every full pass.
  this.tailWalkNodes_ = 0;
  this.tailWalkMs_ = 0;
  this.tailWalkCount_ = 0;
  this.tailWalkTruncated_ = 0;
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
 * PATCH 19 (2026-11-06): upper bound on how many stacks one frame may bring
 * back into the document. Restoring a stack is a handful of DOM writes, but
 * each one invalidates the layout of the whole block canvas, so the count is
 * the real limiter; the time budget below only catches a slow outlier.
 * @const {number}
 */
Blockly.IntersectionObserver.MAX_RESTORE_PER_FRAME = 40;

/**
 * PATCH 19 (2026-11-06): ceiling for the adaptive restore cap. A zoom out can
 * put thousands of stacks inside the viewport at once; the cap grows with the
 * backlog (see RESTORE_DRAIN_FRAMES) but never past this, which bounds the
 * layout a single frame can schedule.
 * @const {number}
 */
Blockly.IntersectionObserver.MAX_RESTORE_BURST = 120;

/**
 * PATCH 19 (2026-11-06): the adaptive restore cap aims to clear the backlog in
 * this many frames.
 * @const {number}
 */
Blockly.IntersectionObserver.RESTORE_DRAIN_FRAMES = 8;

/**
 * PATCH 19 (2026-11-06): wall clock budget for the restore phase of one pass,
 * in milliseconds.
 * @const {number}
 */
Blockly.IntersectionObserver.RESTORE_BUDGET_MS = 4;

/**
 * PATCH 19 (2026-11-06): upper bound on how many stacks one frame may re-lay
 * out. render() measures text with getComputedTextLength(), which is a forced
 * synchronous layout each time.
 * @const {number}
 */
Blockly.IntersectionObserver.MAX_RENDER_PER_FRAME = 8;

/**
 * PATCH 19 (2026-11-06): wall clock budget for the render phase, in
 * milliseconds.
 * @const {number}
 */
Blockly.IntersectionObserver.RENDER_BUDGET_MS = 4;

/**
 * PATCH 19 (2026-11-06): read the clock once every this many items instead of
 * once per item, so the sampling never shows up in the profile. The first item
 * of a loop always runs, which is what proves the backlog shrinks every frame.
 * @const {number}
 */
Blockly.IntersectionObserver.CLOCK_STRIDE = 8;

/**
 * PATCH 21/23 (2026-11-07): distance below the viewport, in workspace units,
 * at which the tail cut sits. PATCH 23 decoupled this from the window step:
 * the cut must stay far enough ahead that restoring the tail (an O(n) walk
 * plus a whole-subtree reattach and raster) finishes BEFORE the viewport
 * reaches it. A larger margin costs a handful of extra DOM blocks per visible
 * branch, not a full screen of them.
 * @const {number}
 */
Blockly.IntersectionObserver.TAIL_CULL_HYSTERESIS = 400;

/**
 * PATCH 23 (2026-11-07): how far the viewport may travel before the cut set
 * is recomputed. This value -- not the margin above -- controls how often the
 * O(n) walk runs. Keeping it at 200 leaves the recompute frequency (and thus
 * the JS cost) unchanged; the extra 200 units of margin are pure lead time
 * for the restore, which is what removes the blank-then-pop frame.
 * @const {number}
 */
Blockly.IntersectionObserver.TAIL_CULL_WINDOW_STEP = 200;

/**
 * PATCH 21: a stack shorter than this (workspace units) is not worth walking.
 * @const {number}
 */
Blockly.IntersectionObserver.TAIL_CULL_MIN_HEIGHT = 1200;

/**
 * PATCH 21: per-frame DOM budgets for tail segments, kept separate from the
 * whole-stack unload/restore budgets.
 * @const {number}
 */
Blockly.IntersectionObserver.MAX_TAIL_CULL_PER_FRAME = 8;
Blockly.IntersectionObserver.MAX_TAIL_RESTORE_PER_FRAME = 16;

/**
 * PATCH 22 (2026-11-07): hard node cap for one stack walk. A truncated walk
 * keeps the previous cut set instead of applying a partial one, so a huge
 * project can never turn a scroll into an unbounded main-thread task. There is
 * deliberately no wall-clock budget: Gandi measures ~19 ms for a 7000-block
 * walk, and a 4 ms cap would truncate every medium project and disable tail
 * culling altogether. The window hysteresis is what keeps walks rare.
 * @const {number}
 */
Blockly.IntersectionObserver.TAIL_CULL_MAX_WALK = 20000;

/**
 * Counters for profiling, mirrored onto window.__cullingStats. Kept in one
 * reused object so a per-frame update does not allocate.
 */
Blockly.IntersectionObserver.stats = {
  frames: 0,
  lastMs: 0,
  culled: 0,
  unloaded: 0,
  restored: 0,
  // PATCH 19 (2026-11-06): metered restore work, so a trace can tell a slow
  // pass from a backed-up one.
  rendered: 0,
  restoreBacklog: 0,
  renderBacklog: 0,
  // PATCH 21 (2026-11-07): segments cut / restored inside visible stacks.
  tailCulled: 0,
  tailRestored: 0,
  tailPending: 0,
  // PATCH 25 (2026-11-07): cost of the decision half, so a slow pass can be
  // attributed to the stack walk instead of guessed at from lastMs alone.
  tailWalkMs: 0,
  tailWalks: 0,
  tailWalkNodes: 0,
  tailTruncated: 0,
  tailWindows: 0
};

/**
 * PATCH 19 (2026-11-06): closest to the viewport centre first. Hoisted so the
 * per-frame sort does not allocate a comparator.
 * @param {{priority: number}} a First candidate.
 * @param {{priority: number}} b Second candidate.
 * @return {number} Sort order.
 * @private
 */
Blockly.IntersectionObserver.priorityCompare_ = function(a, b) {
  return a.priority - b.priority;
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
  // PATCH 21: a stack that stopped being observed must not keep a cached cut
  // set (and with it a reference to blocks that may be disposed).
  if (this.tailWindows_) {
    this.tailWindows_.delete(block);
  }
  // PATCH 11 (2026-10-10): membership changed -> cached rects are stale.
  this.contentDirty_ = true;
};

Blockly.IntersectionObserver.prototype.dispose = function() {
  this.observing = [];
  this.observingSet_ = null;
  this.pendingRenders_ = [];
  // PATCH 19 (2026-11-06): drop the metering tables; they hold block references.
  this.restoreSlotPool_ = [];
  this.restoreCandidates_ = [];
  this.restoreBacklog_ = 0;
  this.autoContinueStalls_ = 0;
  // PATCH 21: drop tail-cull bookkeeping; it holds block references.
  this.tailWindows_.clear();
  this.tailCulledBlocks_.clear();
  this.tailDesired_.length = 0;
  this.tailDesiredSet_.clear();
  this.tailVisited_.clear();
  this.tailPending_ = false;
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
  // A flyout and a mutator keep every block in the document *and* visible: they
  // insert background rectangles relative to the blocks and measure themselves
  // with getBBox(), which only counts attached, rendered nodes. They are now
  // fully excluded from culling by the early guard in checkForIntersections
  // (which also restores any block a prior pass had hidden). This gate is a
  // redundant safety net in case that guard is bypassed.
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

/**
 * PATCH 19 (2026-11-06): bring back at most one frame's worth of the stacks the
 * pass collected, closest to the viewport centre first. A candidate that gets
 * no slot keeps intersects_ false and display:none, and the next pass
 * recomputes it from scratch -- which is why this needs neither a queue nor any
 * cross-frame guard.
 * @param {number} count Number of live entries in restoreCandidates_.
 * @param {boolean} hasPerformance Whether performance.now is available.
 * @return {number} How many stacks were restored.
 * @private
 */
Blockly.IntersectionObserver.prototype.restoreVisibleBlocks_ = function(
    count, hasPerformance) {
  var candidates = this.restoreCandidates_;
  var cap = Math.ceil(count /
      Blockly.IntersectionObserver.RESTORE_DRAIN_FRAMES);
  if (cap < Blockly.IntersectionObserver.MAX_RESTORE_PER_FRAME) {
    cap = Blockly.IntersectionObserver.MAX_RESTORE_PER_FRAME;
  } else if (cap > Blockly.IntersectionObserver.MAX_RESTORE_BURST) {
    cap = Blockly.IntersectionObserver.MAX_RESTORE_BURST;
  }
  if (count > 1) {
    candidates.sort(Blockly.IntersectionObserver.priorityCompare_);
  }
  var limit = cap < count ? cap : count;
  var deadline = (hasPerformance ? performance.now() : Date.now()) +
      Blockly.IntersectionObserver.RESTORE_BUDGET_MS;
  // The clock is sampled every CLOCK_STRIDE items, never on the first one, so
  // every pass with a backlog restores at least one stack and the backlog is
  // guaranteed to shrink.
  var mask = Blockly.IntersectionObserver.CLOCK_STRIDE - 1;
  var restored = 0;
  var c = 0;
  for (; c < limit; c++) {
    var slot = candidates[c];
    var block = slot.block;
    // Never pin a block reference between frames.
    slot.block = null;
    if (!block) {
      // Defensive: the view was truncated under us. Stop rather than throw.
      break;
    }
    block.setIntersects(true);
    restored++;
    if ((c & mask) === mask &&
        (hasPerformance ? performance.now() : Date.now()) >= deadline) {
      c++;
      break;
    }
  }
  for (; c < count; c++) {
    candidates[c].block = null;
  }
  this.restoreBacklog_ = count - restored;
  return restored;
};

/**
 * PATCH 19 (2026-11-06): lay out the stacks a previous pass brought back from
 * display:none. Metered across frames with an in-place compaction, so the
 * workspace resizes the scrollbars once per frame instead of once per stack.
 * @param {boolean=} opt_unbounded Ignore the budget. Used only by the branch
 *     that restores the whole workspace at once (culling switched off).
 * @return {number} How many stacks were rendered.
 * @private
 */
Blockly.IntersectionObserver.prototype.flushPendingRenders_ = function(
    opt_unbounded) {
  var pending = this.pendingRenders_;
  var workspace = this.workspace;
  if (!pending.length) {
    return 0;
  }
  if (!workspace) {
    pending.length = 0;
    return 0;
  }
  var hasPerformance = typeof performance !== 'undefined' && !!performance.now;
  var now = hasPerformance ? performance.now : Date.now;
  var limit = opt_unbounded ?
      Infinity : Blockly.IntersectionObserver.MAX_RENDER_PER_FRAME;
  var deadline = opt_unbounded ?
      Infinity : now() + Blockly.IntersectionObserver.RENDER_BUDGET_MS;
  var mask = Blockly.IntersectionObserver.CLOCK_STRIDE - 1;
  var rendered = 0;
  // Write pointer for the in-place compaction. w <= r at all times, so a
  // deferred entry is never copied over an entry that is still unread.
  var w = 0;
  workspace.beginContentUpdate_();
  try {
    for (var r = 0; r < pending.length; r++) {
      var block = pending[r];
      // Dropped rather than deferred: a disposed block throws on measure, and a
      // block that is unloaded or display:none reports zero text, which would
      // write a zero width into the content rect table and shrink the
      // scrollbars for good. needsRenderOnReload_ stays set, so the next
      // restore queues it again.
      if (!block.workspace || !block.needsRenderOnReload_ ||
          block.unloaded_ || !block.intersects_) {
        block.renderPending_ = false;
        continue;
      }
      if (rendered >= limit ||
          (rendered > 0 && (r & mask) === mask && now() >= deadline)) {
        pending[w++] = block;
        continue;
      }
      // Clear before rendering, as the unbudgeted version did: a render that
      // throws must not leave the queue spinning on the same block.
      block.needsRenderOnReload_ = false;
      block.renderPending_ = false;
      block.render();
      rendered++;
    }
  } finally {
    workspace.endContentUpdate_();
    pending.length = w;
  }
  return rendered;
};

/**
 * PATCH 21 (2026-11-07): forget cached tail windows. With `restore`, every cut
 * segment is attached back immediately, outside any budget. Used when culling
 * is switched off and by the observer's own reset paths.
 * @param {boolean} restore Whether to attach the cut roots back.
 * @package
 */
Blockly.IntersectionObserver.prototype.clearTailCullState_ = function(restore) {
  if (restore) {
    this.tailCulledBlocks_.forEach(function(block) {
      if (block.workspace && block.unloaded_) {
        block.setTailCulled_(false);
      }
    });
  }
  this.tailCulledBlocks_.clear();
  this.tailWindows_.clear();
  this.tailDesired_.length = 0;
  this.tailDesiredSet_.clear();
  this.tailVisited_.clear();
  this.tailPending_ = false;
};

/**
 * PATCH 21: restore every cut segment of one stack immediately. A whole-stack
 * unload moves the top <g> into the offscreen layer; an anchor left inside
 * that subtree could not be recovered afterwards.
 * @param {!Blockly.BlockSvg} root Top-level block of the stack.
 * @private
 */
Blockly.IntersectionObserver.prototype.restoreTailCutsForStack_ = function(root) {
  var done = [];
  this.tailCulledBlocks_.forEach(function(block) {
    if (!block.workspace || !block.unloaded_) {
      done.push(block);
    } else if (block.getRootBlock() === root) {
      block.setTailCulled_(false);
      done.push(block);
    }
  });
  for (var i = 0; i < done.length; i++) {
    this.tailCulledBlocks_.delete(done[i]);
  }
  this.tailWindows_.delete(root);
};

/**
 * PATCH 25 (2026-11-07): accumulate one stack walk into the per-pass counters.
 * Reading the clock here is fine -- the decision half may not do geometry
 * reads (getBoundingClientRect / getComputedTextLength), but a monotonic clock
 * is not a layout read.
 * @param {number} nodes Blocks visited.
 * @param {number} startTime Clock reading taken before the walk.
 * @param {boolean} hasPerf Whether performance.now is available.
 * @param {boolean} truncated Whether the node cap stopped the walk.
 * @private
 */
Blockly.IntersectionObserver.prototype.recordTailWalk_ = function(
    nodes, startTime, hasPerf, truncated) {
  this.tailWalkNodes_ += nodes;
  this.tailWalkCount_++;
  if (truncated) {
    this.tailWalkTruncated_++;
  }
  if (hasPerf) {
    this.tailWalkMs_ += performance.now() - startTime;
  }
};

/**
 * PATCH 21/22: walk one stack and return the first block of every branch that
 * starts below cutLine. Iterative, so a 4000-block chain cannot overflow the
 * JS stack. Reads only attributes and Block geometry: no getBoundingClientRect,
 * no getComputedTextLength, and no DOM writes.
 *
 * Block.getChildren(false) already returns EVERY child including the next
 * block (Block.setParent pushes unconditionally, block.js:585). Adding
 * getNextBlock() on top of it visits each next block twice, which makes the
 * walk exponential in stack depth -- a deep if/else froze the editor.
 * @param {!Blockly.BlockSvg} top Top-level block of the stack.
 * @param {number} startY Workspace y of the stack top.
 * @param {number} cutLine Workspace y below which a block may be cut.
 * @param {?Element} draggedNode Root currently on the drag surface.
 * @return {?Array.<!Blockly.BlockSvg>} Cut blocks, or null when the walk hit
 *     a safety budget (the caller then keeps the previous cut set).
 * @private
 */
Blockly.IntersectionObserver.prototype.collectTailCuts_ = function(
    top, startY, cutLine, draggedNode) {
  var hasPerf = typeof performance !== 'undefined' && !!performance.now;
  var startTime = hasPerf ? performance.now() : 0;
  var cuts = [];
  var pending = [{block: top, y: startY}];
  var visited = this.tailVisited_;
  visited.clear();
  var maxWalk = Blockly.IntersectionObserver.TAIL_CULL_MAX_WALK;
  while (pending.length) {
    var item = pending.pop();
    var block = item.block;
    if (!block || !block.workspace || visited.has(block)) {
      continue;
    }
    visited.add(block);
    if (visited.size > maxWalk) {
      this.recordTailWalk_(visited.size, startTime, hasPerf, true);
      return null;
    }
    // PATCH 21 FIX (2026-11-07): a detached cut must NOT be pinned into the
    // desired set. This walk is geometry-only, and an unloaded root keeps both
    // its Block links and its transform attribute while it sits in the
    // offscreen layer, so descending through it lets the cut point move down
    // as the viewport scrolls. Pinning it froze the cut: the tail never came
    // back unless some unrelated operation forced a reattach.
    var root = block.getSvgRoot && block.getSvgRoot();
    if (!root || (draggedNode && root === draggedNode)) {
      continue;
    }
    if (item.y > cutLine && block.getParent()) {
      cuts.push(block);
      continue;
    }
    var children = block.getChildren && block.getChildren(false);
    for (var i = 0; children && i < children.length; i++) {
      var child = children[i];
      var childRoot = child && child.getSvgRoot && child.getSvgRoot();
      var rel = childRoot ? Blockly.utils.getRelativeXY(childRoot) : null;
      pending.push({block: child, y: item.y + (rel ? rel.y : 0)});
    }
  }
  this.recordTailWalk_(visited.size, startTime, hasPerf, false);
  return cuts;
};

/**
 * PATCH 21/23: window hysteresis. Reuse the last cut set while the viewport
 * stays inside the cached window and workspace geometry has not changed. The
 * key is an integer generation counter, never a floating point bounding box.
 * Window size uses WINDOW_STEP, cut position uses HYSTERESIS; PATCH 21 used
 * one constant for both, so a recompute only started when the cut had already
 * reached the viewport edge -- too late to hide the restore on a big project.
 * @param {!Blockly.BlockSvg} top Top-level block.
 * @param {!Object} rect Cached content rectangle, workspace units.
 * @param {number} viewportTop Workspace y at the top of the viewport.
 * @param {number} viewportBottom Workspace y at the bottom of the viewport.
 * @param {number} generation Workspace geometry generation.
 * @param {?Element} draggedNode Root currently on the drag surface.
 * @return {!Array.<!Blockly.BlockSvg>} Cut blocks.
 * @private
 */
Blockly.IntersectionObserver.prototype.computeTailCuts_ = function(
    top, rect, viewportTop, viewportBottom, generation, draggedNode) {
  var h = Blockly.IntersectionObserver.TAIL_CULL_HYSTERESIS;
  var w = Blockly.IntersectionObserver.TAIL_CULL_WINDOW_STEP;
  // A stack that is still display:none or still in the offscreen layer must not
  // cache an empty cut set: the restore happens later in this very pass, and
  // the window would otherwise keep handing back "nothing to cut" forever.
  if (top.unloaded_ || !top.intersects_) {
    this.tailWindows_.delete(top);
    return [];
  }
  var win = this.tailWindows_.get(top);
  if (win && win.generation === generation &&
      viewportTop >= win.minY && viewportBottom <= win.maxY) {
    return win.cuts;
  }
  var cuts = this.collectTailCuts_(top, rect.top,
      viewportBottom + h, draggedNode);
  if (!cuts) {
    // PATCH 22: a truncated walk must not be cached and must not change the
    // desired set. Applying a partial cut set would restore every detached
    // segment of the branches we never reached, causing a DOM surge exactly
    // on the frame that is already expensive.
    return win ? win.cuts : [];
  }
  this.tailWindows_.set(top, {
    minY: viewportTop - w,
    maxY: viewportBottom + w,
    generation: generation,
    cuts: cuts
  });
  return cuts;
};

/**
 * PATCH 21: incremental apply. Only the difference between the desired cut set
 * and what is actually detached touches the DOM; when cut points have not
 * moved this performs zero DOM operations. Cull and restore run on independent
 * per-frame budgets.
 * @param {!Array.<!Blockly.BlockSvg>} desired Cut blocks wanted this frame.
 * @return {{culled: number, restored: number}} Work done.
 * @private
 */
Blockly.IntersectionObserver.prototype.applyTailCuts_ = function(desired) {
  var desiredSet = this.tailDesiredSet_;
  desiredSet.clear();
  for (var a = 0; a < desired.length; a++) {
    if (desired[a]) {
      desiredSet.add(desired[a]);
    }
  }
  var stale = [];
  var restore = [];
  this.tailCulledBlocks_.forEach(function(block) {
    if (!block.workspace || !block.unloaded_ || !block.tailCulled_) {
      stale.push(block);
    } else if (!desiredSet.has(block)) {
      restore.push(block);
    }
  });
  for (var s = 0; s < stale.length; s++) {
    this.tailCulledBlocks_.delete(stale[s]);
  }
  var cull = [];
  desiredSet.forEach(function(block) {
    if (block && block.workspace && !block.unloaded_) {
      cull.push(block);
    }
  });
  var maxRestore = Blockly.IntersectionObserver.MAX_TAIL_RESTORE_PER_FRAME;
  var maxCull = Blockly.IntersectionObserver.MAX_TAIL_CULL_PER_FRAME;
  var restored = 0;
  var culled = 0;
  var i;
  for (i = 0; i < restore.length && restored < maxRestore; i++) {
    if (restore[i].setTailCulled_(false)) {
      this.tailCulledBlocks_.delete(restore[i]);
      restored++;
    }
  }
  // PATCH 21 FIX: a new cut can be a descendant of an old one. Cutting it
  // while its parent is still in the offscreen layer would leave its anchor
  // unreachable, so finish every restore before starting any new cut.
  if (restored < restore.length) {
    cull.length = 0;
  }
  for (i = 0; i < cull.length && culled < maxCull; i++) {
    if (cull[i].setTailCulled_(true)) {
      this.tailCulledBlocks_.add(cull[i]);
      culled++;
    }
  }
  this.tailPending_ = restored < restore.length || culled < cull.length;
  return {culled: culled, restored: restored};
};

Blockly.IntersectionObserver.prototype.checkForIntersections = function() {
  this.intersectionCheckQueued = false;

  if (!this.workspace) {
    return;
  }

  // A flyout and a mutator keep every block in the document *and* visible: they
  // measure themselves with getBBox() and attach background rectangles to the
  // blocks, both of which break once a node is display:none'd or moved out of
  // the document. The main workspace is the only one that benefits from viewport
  // culling. viewportCullingEnabled_ also gates the display:none pass here (not
  // just the unload pass in canUnloadStacks_), so disabling it fully restores
  // the workspace. Anything a previous pass hid is shown again.
  if (this.workspace.isFlyout || this.workspace.isMutator ||
      !this.workspace.viewportCullingEnabled_) {
    for (var i = 0; i < this.observing.length; i++) {
      this.observing[i].setIntersects(true);
    }
    // PATCH 19 (2026-11-06): this branch shows everything at once, so the
    // metering is meaningless here. Lay out whatever still owed a render in one
    // go -- a toggle is a one-off, not a per-frame path -- and drop the restore
    // bookkeeping. Without this the queued stacks would wait for a pass that
    // never comes back to the metered branch.
    this.restoreBacklog_ = 0;
    this.autoContinueStalls_ = 0;
    // PATCH 21: culling off means no segment may stay in the offscreen layer.
    this.clearTailCullState_(true);
    this.flushPendingRenders_(true);
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

  // PATCH 19 (2026-11-06): a deferred restore is ordered by distance to the
  // centre of the viewport, so the stacks the user is looking at come back
  // first. Precomputed once: the per-block term is then two multiplies and a
  // compare. A zero-sized viewport falls back to all-zero priorities, which
  // leaves the candidate order untouched instead of producing NaN.
  var centreX = workspaceWidth * 0.5;
  var centreY = workspaceHeight * 0.5;
  var invHalfWidth = workspaceWidth > 0 ? 2 / workspaceWidth : 0;
  var invHalfHeight = workspaceHeight > 0 ? 2 / workspaceHeight : 0;

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
  // Scratch: Blockly.selected can be a workspace comment (no getRootBlock()).
  // A comment has no parent stack to keep loaded, so leave selectedRoot null.
  if (Blockly.selected && typeof Blockly.selected.getRootBlock === 'function' &&
      Blockly.selected.workspace === workspace) {
    selectedRoot = Blockly.selected.getRootBlock();
  }
  var unloadDistance = Blockly.IntersectionObserver.UNLOAD_SCREENS;
  // PATCH 21 (2026-11-07): viewport in workspace units. canvasPos is already
  // in screen pixels while rects are workspace units, so invert the same
  // transform the visibility test uses.
  var tailScale = workspaceScale > 0 ? workspaceScale : 1;
  var viewportTop = -canvasPos.y / tailScale;
  var viewportBottom = (workspaceHeight - canvasPos.y) / tailScale;
  // PATCH 24: geometry generation is per top element now; query it at the call
  // site so editing one stack cannot invalidate every other stack's window.
  // PATCH 25: per-pass tail-walk counters, reset once before the read phase.
  this.tailWalkNodes_ = 0;
  this.tailWalkMs_ = 0;
  this.tailWalkCount_ = 0;
  this.tailWalkTruncated_ = 0;
  var tailEnabled = canUnload &&
      !(workspace.boxDragActiveBlocks_ && workspace.boxDragActiveBlocks_.size) &&
      !(workspace.frameDragActiveBlocks_ && workspace.frameDragActiveBlocks_.size);
  var tailDesired = this.tailDesired_;
  tailDesired.length = 0;
  var candidates = null;
  var culledCount = 0;
  var unloadedCount = 0;
  var restoredCount = 0;
  // PATCH 19 (2026-11-06): a visible stack that was hidden last frame is only
  // collected here; the DOM write happens in restoreVisibleBlocks_ under a
  // budget. slotPool_ is never reallocated, so a pass allocates nothing.
  var restoreCount = 0;
  var slotPool = this.restoreSlotPool_;
  var slotView = this.restoreCandidates_;

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

    // PATCH (2026-11-02): a box drag's follower blocks live on the flyout-top
    // follower surface, not under the dragged main block, so the draggedNode
    // check above does not cover them.  Dragging the selection against a screen
    // edge moves their (real, already-updated) rects outside the view, and this
    // pass would hide them mid-drag.  The gesture flags every block that takes
    // part in an active box drag on the workspace; skip those too.
    if (workspace.boxDragActiveBlocks_ &&
        workspace.boxDragActiveBlocks_.has(block)) {
      block.setIntersects(true);
      continue;
    }
    // A frame drag moves its members with it; the pass must leave their
    // display state alone until the drag ends.
    if (workspace.frameDragActiveBlocks_ &&
        workspace.frameDragActiveBlocks_.has(block)) {
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

    if (!visible) {
      // Hiding is cheap (it drops the subtree from the paint tree) and never
      // needs a budget, so it stays inline.
      block.setIntersects(false);
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
      continue;
    }

    // PATCH 21 (2026-11-07): decide the cut set for this visible stack. This
    // is the read-only half: no DOM writes, and no geometry read that forces
    // layout. Short stacks and the stack holding the selection are left alone.
    if (tailEnabled &&
        rect.height > Blockly.IntersectionObserver.TAIL_CULL_MIN_HEIGHT &&
        block !== selectedRoot &&
        !(Blockly.selected && Blockly.selected.workspace === workspace &&
          typeof Blockly.selected.getRootBlock === 'function' &&
          Blockly.selected.getRootBlock() === block)) {
      var cuts = this.computeTailCuts_(block, rect, viewportTop,
          viewportBottom, workspace.getGeometryGeneration_(block), draggedNode);
      for (var t = 0; t < cuts.length; t++) {
        tailDesired.push(cuts[t]);
      }
    } else if (this.tailWindows_.has(block)) {
      this.tailWindows_.delete(block);
    }

    // Visible. A stack that was hidden last frame is collected instead of being
    // written to the DOM here: a zoom out crosses the visibility threshold for
    // hundreds of stacks in the same frame, and doing them all at once is a
    // long task that freezes the editor. Anything this pass cannot afford keeps
    // intersects_ false and display:none, so the next pass picks it up again --
    // the pass itself is the retry queue.
    if (!wasIntersecting) {
      var slot = slotPool[restoreCount];
      if (!slot) {
        slot = {block: null, priority: 0};
        slotPool[restoreCount] = slot;
      }
      var slotX = canvasPos.x + blockPosX + blockWidth * 0.5 - centreX;
      var slotY = canvasPos.y + blockPosY + blockHeight * 0.5 - centreY;
      slot.block = block;
      slot.priority = Math.max(
          Math.abs(slotX) * invHalfWidth,
          Math.abs(slotY) * invHalfHeight);
      slotView[restoreCount] = slot;
      restoreCount++;
      continue;
    }

    // Already on screen. It can still owe a render: the forced restore paths
    // attach without consuming it (see BlockSvg.attachToCanvas_). renderPending_
    // keeps the queue from collecting one duplicate per frame while it waits.
    if (block.needsRenderOnReload_ && !block.renderPending_) {
      block.renderPending_ = true;
      this.pendingRenders_.push(block);
    }
  }

  // Truncation only drops references; the slot records stay in the pool.
  slotView.length = restoreCount;

  // PATCH 19 (2026-11-06): spend the restore budget before the unload sort, so
  // the stacks the user is actually looking at fill in first.
  if (restoreCount) {
    restoredCount = this.restoreVisibleBlocks_(restoreCount, hasPerformance);
  } else {
    this.restoreBacklog_ = 0;
  }

  // PATCH 21: apply the cut diff before any whole-stack unload. An unload
  // moves the top <g> into the offscreen layer, and an anchor still inside
  // that subtree could not be recovered afterwards.
  var tailResult = {culled: 0, restored: 0};
  if (tailEnabled) {
    tailResult = this.applyTailCuts_(tailDesired);
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
      this.restoreTailCutsForStack_(candidates[c].block);
      candidates[c].block.setUnloaded_(true);
      if (candidates[c].block.unloaded_) {
        unloadedCount++;
      }
    }
  }

  // Blocks that came back owe a render, because their fields may have changed
  // while they were out of the document. PATCH 19 (2026-11-06): metered, and
  // the leftovers stay queued -- one render is a forced text measurement, which
  // is the other half of the long task a zoom out used to produce.
  var renderedCount = 0;
  if (this.pendingRenders_.length) {
    renderedCount = this.flushPendingRenders_(false);
  }

  var stats = Blockly.IntersectionObserver.stats;
  stats.frames++;
  stats.culled = culledCount;
  stats.unloaded = unloadedCount;
  stats.restored = restoredCount;
  stats.rendered = renderedCount;
  stats.restoreBacklog = this.restoreBacklog_;
  stats.renderBacklog = this.pendingRenders_.length;
  // PATCH 21: segments cut / restored inside visible stacks this frame.
  stats.tailCulled = tailResult.culled;
  stats.tailRestored = tailResult.restored;
  stats.tailPending = this.tailPending_ ? 1 : 0;
  // PATCH 25: split the pass cost. tailWalkMs is the decision half only;
  // lastMs minus that is the DOM apply + render half.
  stats.tailWalkMs = this.tailWalkMs_;
  stats.tailWalks = this.tailWalkCount_;
  stats.tailWalkNodes = this.tailWalkNodes_;
  stats.tailTruncated = this.tailWalkTruncated_;
  stats.tailWindows = this.tailWindows_.size;
  stats.lastMs = (hasPerformance ? performance.now() : Date.now()) - startTime;
  if (typeof window !== 'undefined') {
    window.__cullingStats = stats;
  }

  // PATCH 19 (2026-11-06): a zoom that stops mid-restore leaves no input event
  // behind to schedule the next sweep, and intersectionCheckQueued was already
  // cleared at the top of this pass, so calling this chains the next animation
  // frame. Every metered pass restores at least one stack, so the chain
  // strictly shrinks the backlog; the stall counter is the stop for anything
  // that breaks that assumption. The extra frame after the last render lets the
  // workspace re-measure what it just laid out (render only invalidates the
  // content bounds, it does not schedule a pass).
  //
  // The requestAnimationFrame guard is not cosmetic: the fallback branch of
  // queueIntersectionCheck is a microtask, which drains inside this very frame
  // and never paints, turning the chain into an infinite loop.
  // PATCH 21: a cut diff that did not finish also needs the next frame.
  var tailPending = tailEnabled && this.tailPending_;
  if (restoredCount > 0 || renderedCount > 0 ||
      tailResult.culled > 0 || tailResult.restored > 0) {
    this.autoContinueStalls_ = 0;
  } else if (this.restoreBacklog_ > 0 || this.pendingRenders_.length > 0 ||
      tailPending) {
    this.autoContinueStalls_++;
  }
  var stillPending = this.restoreBacklog_ > 0 ||
      this.pendingRenders_.length > 0 || renderedCount > 0 || tailPending;
  var workspaceVisible = !workspace.isVisible || workspace.isVisible();
  if (stillPending && workspaceVisible && window.requestAnimationFrame &&
      this.autoContinueStalls_ < 2) {
    this.queueIntersectionCheck();
  }
};
