/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2017 Google Inc.
 * https://developers.google.com/blockly/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Methods for dragging a workspace visually.
 * @author fenichel@google.com (Rachel Fenichel)
 */
'use strict';

goog.provide('Blockly.WorkspaceDragger');

goog.require('goog.math.Coordinate');
goog.require('goog.asserts');


/**
 * Class for a workspace dragger.  It moves the workspace around when it is
 * being dragged by a mouse or touch.
 * Note that the workspace itself manages whether or not it has a drag surface
 * and how to do translations based on that.  This simply passes the right
 * commands based on events.
 * @param {!Blockly.WorkspaceSvg} workspace The workspace to drag.
 * @constructor
 */
Blockly.WorkspaceDragger = function(workspace) {
  /**
   * @type {!Blockly.WorkspaceSvg}
   * @private
   */
  this.workspace_ = workspace;

  /**
   * The workspace's metrics object at the beginning of the drag.  Contains size
   * and position metrics of a workspace.
   * Coordinate system: pixel coordinates.
   * @type {!Object}
   * @private
   */
  this.startDragMetrics_ = workspace.getMetrics();

  /**
   * The scroll position of the workspace at the beginning of the drag.
   * Coordinate system: pixel coordinates.
   * @type {!goog.math.Coordinate}
   * @private
   */
  this.startScrollXY_ = new goog.math.Coordinate(
      workspace.scrollX, workspace.scrollY);
};

/**
 * Sever all links from this object.
 * @package
 */
Blockly.WorkspaceDragger.prototype.dispose = function() {
  this.workspace_ = null;
  // Cancel any coalesced drag frame so a disposed dragger can't fire later.
  this.rafScheduled_ = false;
  this.pendingDragDelta_ = null;
  if (this.rafId_ && window.cancelAnimationFrame) {
    window.cancelAnimationFrame(this.rafId_);
  }
  this.rafId_ = null;
};

/**
 * Start dragging the workspace.
 * @package
 */
Blockly.WorkspaceDragger.prototype.startDrag = function() {
  if (Blockly.selected) {
    Blockly.selected.unselect();
  }
  // Refresh the scrollbar ratio_ from the CURRENT content bounds before
  // capturing the drag baseline. Deleting a workspace comment (or any content
  // change) can alter contentWidth/contentHeight without a matching
  // scrollbar.resize(), leaving ratio_ stale. A stale ratio_ makes
  // scrollbar.set -> setMetrics a NON-identity round-trip, so the first pan
  // frame computes the wrong scroll and the workspace jumps a little before
  // tracking the pointer correctly. Recomputing ratio_ here keeps the drag
  // math exact. (2026-08-28)
  var scrollbar = this.workspace_.scrollbar;
  if (scrollbar) {
    var m = this.workspace_.getMetrics();
    if (m) {
      if (scrollbar.hScroll) {
        var hr = scrollbar.hScroll.scrollViewSize_ / m.contentWidth;
        scrollbar.hScroll.ratio_ = isNaN(hr) || !isFinite(hr) ? 0 : hr;
      }
      if (scrollbar.vScroll) {
        var vr = scrollbar.vScroll.scrollViewSize_ / m.contentHeight;
        scrollbar.vScroll.ratio_ = isNaN(vr) || !isFinite(vr) ? 0 : vr;
      }
    }
  }
  this.startDragMetrics_ = this.workspace_.getMetrics();
  this.startScrollXY_ = new goog.math.Coordinate(
      this.workspace_.scrollX, this.workspace_.scrollY);
  this.workspace_.setupDragSurface();
};

/**
 * Finish dragging the workspace and put everything back where it belongs.
 * @param {!goog.math.Coordinate} currentDragDeltaXY How far the pointer has
 *     moved from the position at the start of the drag, in pixel coordinates.
 * @package
 */
Blockly.WorkspaceDragger.prototype.endDrag = function(currentDragDeltaXY) {
  // Apply the final position synchronously (flush any coalesced frame) so
  // resetDragSurface sees the correct position. (2026-08-28)
  this.pendingDragDelta_ = currentDragDeltaXY;
  if (this.rafScheduled_ && this.rafId_ && window.cancelAnimationFrame) {
    window.cancelAnimationFrame(this.rafId_);
    this.rafId_ = null;
    this.rafScheduled_ = false;
  }
  this.applyDrag_();
  this.workspace_.resetDragSurface();
};

/**
 * Move the workspace based on the most recent mouse movements.
 * @param {!goog.math.Coordinate} currentDragDeltaXY How far the pointer has
 *     moved from the position at the start of the drag, in pixel coordinates.
 * @package
 */
Blockly.WorkspaceDragger.prototype.drag = function(currentDragDeltaXY) {
  // Coalesce pointer moves into one scroll per animation frame. (2026-08-28)
  this.pendingDragDelta_ = currentDragDeltaXY;
  if (!this.rafScheduled_) {
    this.rafScheduled_ = true;
    var self = this;
    this.rafId_ = requestAnimationFrame(function() {
      self.rafScheduled_ = false;
      self.rafId_ = null;
      self.applyDrag_();
    });
  }
};

/**
 * Apply the coalesced drag delta to the scrollbars. Separated from drag() so the
 * pending frame (and endDrag's synchronous flush) share one code path.
 * @private
 */
Blockly.WorkspaceDragger.prototype.applyDrag_ = function() {
  var metrics = this.startDragMetrics_;
  if (!metrics || !this.workspace_) {
    return;
  }
  var newXY = goog.math.Coordinate.sum(this.startScrollXY_,
      this.pendingDragDelta_);

  // Bound the new XY based on workspace bounds.
  var x = Math.min(newXY.x, -metrics.contentLeft);
  var y = Math.min(newXY.y, -metrics.contentTop);
  x = Math.max(x, metrics.viewWidth - metrics.contentLeft -
               metrics.contentWidth);
  y = Math.max(y, metrics.viewHeight - metrics.contentTop -
               metrics.contentHeight);

  x = -x - metrics.contentLeft;
  y = -y - metrics.contentTop;

  this.updateScroll_(x, y);
};

/**
 * Move the scrollbars to drag the workspace.
 * x and y are in pixels.
 * @param {number} x The new x position to move the scrollbar to.
 * @param {number} y The new y position to move the scrollbar to.
 * @private
 */
Blockly.WorkspaceDragger.prototype.updateScroll_ = function(x, y) {
  this.workspace_.scrollbar.set(x, y);
};
