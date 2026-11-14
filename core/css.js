/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2013 Google Inc.
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
 * @fileoverview Inject Blockly's CSS synchronously.
 * @author fraser@google.com (Neil Fraser)
 */
'use strict';

/**
 * @name Blockly.Css
 * @namespace
 */
goog.provide('Blockly.Css');

goog.require('Blockly.Colours');

goog.require('goog.userAgent');

/**
 * List of cursors.
 * @enum {string}
 */
Blockly.Css.Cursor = {
  OPEN: 'handopen',
  CLOSED: 'handclosed',
  DELETE: 'handdelete'
};

/**
 * Current cursor (cached value).
 * @type {string}
 * @private
 */
Blockly.Css.currentCursor_ = '';

/**
 * Large stylesheet added by Blockly.Css.inject.
 * @type {Element}
 * @private
 */
Blockly.Css.styleSheet_ = null;

/**
 * Path to media directory, with any trailing slash removed.
 * @type {string}
 * @private
 */
Blockly.Css.mediaPath_ = '';

/**
 * Inject the CSS into the DOM.  This is preferable over using a regular CSS
 * file since:
 * a) It loads synchronously and doesn't force a redraw later.
 * b) It speeds up loading by not blocking on a separate HTTP transfer.
 * c) The CSS content may be made dynamic depending on init options.
 * @param {boolean} hasCss If false, don't inject CSS
 *     (providing CSS becomes the document's responsibility).
 * @param {string} pathToMedia Path from page to the Blockly media directory.
 */
Blockly.Css.inject = function(hasCss, pathToMedia) {
  // Clear the CSS if it has already been injected.
  if (Blockly.Css.styleSheet_) {
    document.head.removeChild(Blockly.Css.styleSheet_.ownerNode);
  }
  // Placeholder for cursor rule.  Must be first rule (index 0).
  var text = '.blocklyDraggable {}\n';
  if (hasCss) {
    text += Blockly.Css.CONTENT.join('\n');
    if (Blockly.FieldDate) {
      text += Blockly.FieldDate.CSS.join('\n');
    }
  }
  // Strip off any trailing slash (either Unix or Windows).
  Blockly.Css.mediaPath_ = pathToMedia.replace(/[\\\/]$/, '');
  text = text.replace(/<<<PATH>>>/g, Blockly.Css.mediaPath_);
  // Dynamically replace colours in the CSS text, in case they have
  // been set at run-time injection.
  // Process longer colour properties first to handle common prefixes.
  var compareByLength = function(a, b) { return b.length - a.length; };
  var colourProperties = Object.keys(Blockly.Colours).sort(compareByLength);
  for (var i = 0, colourProperty; colourProperty = colourProperties[i]; i++) {
    // Replace all
    text = text.replace(
      new RegExp('\\$colour\\_' + colourProperty, 'g'),
      Blockly.Colours[colourProperty]
    );
  }

  // Inject CSS tag at start of head.
  var cssNode = document.createElement('style');
  document.head.insertBefore(cssNode, document.head.firstChild);

  var cssTextNode = document.createTextNode(text);
  cssNode.appendChild(cssTextNode);
  Blockly.Css.styleSheet_ = cssNode.sheet;
};

/**
 * Set the cursor to be displayed when over something draggable.
 * See See https://github.com/google/blockly/issues/981 for context.
 * @param {Blockly.Css.Cursor} cursor Enum.
 * @deprecated April 2017.
 */
Blockly.Css.setCursor = function(cursor) {
  console.warn('Deprecated call to Blockly.Css.setCursor.' +
    'See https://github.com/google/blockly/issues/981 for context');
};

/**
 * Array making up the CSS content for Blockly.
 */
Blockly.Css.CONTENT = [
  '.blocklySvg {',
    'background-color: $colour_workspace;',
    'outline: none;',
    'overflow: hidden;',  /* IE overflows by default. */
    'position: absolute;',
    'display: block;',
  '}',

  /* Necessary to position the drag surface */
  '.blocklyRelativeWrapper {',
    'position: relative;',
    'width: 100%;',
    'height: 100%;',
  '}',

  '.blocklyWidgetDiv {',
    'display: none;',
    'position: absolute;',
    'z-index: 99999;', /* big value for bootstrap3 compatibility */
  '}',

  '.injectionDiv {',
    'height: 100%;',
    'position: relative;',
    'overflow: hidden;', /* So blocks in drag surface disappear at edges */
    'touch-action: none',
  '}',

  '.blocklyNonSelectable {',
    'user-select: none;',
    '-moz-user-select: none;',
    '-webkit-user-select: none;',
    '-ms-user-select: none;',
  '}',

  '.blocklyWidgetDiv.fieldTextInput {',
    'overflow: hidden;',
    'border: 1px solid;',
    'box-sizing: border-box;',
    'transform-origin: 0 0;',
    '-ms-transform-origin: 0 0;',
    '-moz-transform-origin: 0 0;',
    '-webkit-transform-origin: 0 0;',
  '}',

  '.blocklyWidgetDiv.fieldTextInput.removableTextInput {',
    'overflow: visible;',
  '}',

  '.blocklyTextDropDownArrow {',
    'position: absolute;',
  '}',

  '.blocklyTextRemoveIcon {',
    'position: absolute;',
    'width: 24px;',
    'height: 24px;',
    'top: -40px;',
    'left: 50%;',
    'margin-left: -12px;',
    'cursor: pointer;',
  '}',

  '.blocklyNonSelectable {',
    'user-select: none;',
    '-moz-user-select: none;',
    '-webkit-user-select: none;',
    '-ms-user-select: none;',
  '}',

  '.blocklyWsDragSurface {',
    'display: none;',
    'position: absolute;',
    'top: 0;',
    'left: 0;',
  '}',
  /* Added as a separate rule with multiple classes to make it more specific
     than a bootstrap rule that selects svg:root. See issue #1275 for context.
  */
  '.blocklyWsDragSurface.blocklyOverflowVisible {',
    'overflow: visible;',
  '}',

  '.blocklyBlockDragSurface {',
    'display: none;',
    'position: absolute;',
    'top: 0;',
    'left: 0;',
    'right: 0;',
    'bottom: 0;',
    'overflow: visible !important;',
    'z-index: 50;', /* Display above the toolbox */
  '}',

  /* Block comment bubbles ride a sibling SVG at the same level as the
     dragged block. They must not live inside the drag surface itself: that
     SVG is CSS-translated every mousemove, which would double-move bubbles
     whose anchors are already updated by BlockDragger.dragIcons_. */
  '.blocklyCommentDragSurface {',
    'display: none;',
    'position: absolute;',
    'top: 0;',
    'left: 0;',
    'right: 0;',
    'bottom: 0;',
    'overflow: visible !important;',
    'pointer-events: none;',
    'z-index: 50;',
  '}',

  /* Scratch-box-select: follower blocks ride a dedicated surface while a box
     drag is active. It must be a sibling of the workspace / flyout / drag
     surface svgs: the flyout is NOT a child of the workspace svg but a
     sibling <svg> inserted after it (inject.js addFlyout_ / toolbox.js
     insertSiblingAfter), so a layer inside the workspace svg always paints
     below the flyout. No blur filter (unlike the drag surface), so tall
     selections are never clipped, and pointer-events:none so it never eats
     drag events. z-index sits above the flyout (20) and the toolbox (40) but
     below the block drag surface (50), so the grabbed main block still paints
     above its followers. */
  '.blocklyBoxDragFollowerSurface {',
    'display: none;',
    'position: absolute;',
    'top: 0;',
    'left: 0;',
    'right: 0;',
    'bottom: 0;',
    'overflow: visible !important;',
    'pointer-events: none;',
    'z-index: 45;',
  '}',

  '.blocklyTooltipDiv {',
    'background-color: #ffffc7;',
    'border: 1px solid #ddc;',
    'box-shadow: 4px 4px 20px 1px rgba(0,0,0,.15);',
    'color: #000;',
    'display: none;',
    'font-family: "Helvetica Neue", Helvetica, sans-serif;',
    'font-size: 9pt;',
    'opacity: 0.9;',
    'padding: 2px;',
    'position: absolute;',
    'z-index: 100000;', /* big value for bootstrap3 compatibility */
  '}',

  '.blocklyDropDownDiv {',
    'position: fixed;',
    'left: 0;',
    'top: 0;',
    'z-index: 1000;',
    'display: none;',
    'border: 1px solid;',
    'border-radius: 4px;',
    'box-shadow: 0px 0px 8px 1px ' + Blockly.Colours.dropDownShadow + ';',
    'padding: 4px;',
    '-webkit-user-select: none;',
    'min-height: 15px',
  '}',

  '.blocklyDropDownContent {',
    'max-height: 300px;', // @todo: spec for maximum height.
    'overflow: auto;',
  '}',

  '.blocklyDropDownArrow {',
    'position: absolute;',
    'left: 0;',
    'top: 0;',
    'width: 16px;',
    'height: 16px;',
    'z-index: -1;',
    'background-color: inherit;',
    'border-color: inherit;',
  '}',

  '.blocklyDropDownButton {',
    'display: inline-block;',
    'float: left;',
    'padding: 0;',
    'margin: 4px;',
    'border-radius: 4px;',
    'outline: none;',
    'border: 1px solid;',
    'transition: box-shadow .1s;',
    'cursor: pointer;',
  '}',

  '.blocklyDropDownButtonHover {',
    'box-shadow: 0px 0px 0px 4px ' + Blockly.Colours.fieldShadow + ';',
  '}',

  '.blocklyDropDownButton:active {',
    'box-shadow: 0px 0px 0px 6px ' + Blockly.Colours.fieldShadow + ';',
  '}',

  '.blocklyDropDownButton > img {',
    'width: 80%;',
    'height: 80%;',
    'margin-top: 5%',
  '}',

  '.blocklyDropDownPlaceholder {',
    'display: inline-block;',
    'float: left;',
    'padding: 0;',
    'margin: 4px;',
  '}',

  '.blocklyNumPadButton {',
    'display: inline-block;',
    'float: left;',
    'padding: 0;',
    'width: 48px;',
    'height: 48px;',
    'margin: 4px;',
    'border-radius: 4px;',
    'background: $colour_numPadBackground;',
    'color: $colour_numPadText;',
    'outline: none;',
    'border: 1px solid $colour_numPadBorder;',
    'cursor: pointer;',
    'font-weight: 600;',
    'font-family: "Helvetica Neue", Helvetica, sans-serif;',
    'font-size: 12pt;',
    '-webkit-tap-highlight-color: rgba(0,0,0,0);',
  '}',

  '.blocklyNumPadButton > img {',
    'margin-top: 10%;',
    'width: 80%;',
    'height: 80%;',
  '}',

  '.blocklyNumPadButton:active {',
    'background: $colour_numPadActiveBackground;',
    '-webkit-tap-highlight-color: rgba(0,0,0,0);',
  '}',

  '.arrowTop {',
    'border-top: 1px solid;',
    'border-left: 1px solid;',
    'border-top-left-radius: 4px;',
    'border-color: inherit;',
  '}',

  '.arrowBottom {',
    'border-bottom: 1px solid;',
    'border-right: 1px solid;',
    'border-bottom-right-radius: 4px;',
    'border-color: inherit;',
  '}',

  '.valueReportBox {',
    'color: $colour_valueReportForeground;',
    'min-width: 50px;',
    'max-width: 300px;',
    'max-height: 200px;',
    'overflow: auto;',
    'word-wrap: break-word;',
    'white-space: pre-wrap;',
    'user-select: text;',
    '-moz-user-select: text;',
    '-webkit-user-select: text;',
    '-ms-user-select: text;',
    'text-align: center;',
    'font-family: "Helvetica Neue", Helvetica, sans-serif;',
    'font-size: .8em;',
  '}',

  '.blocklyResizeSE {',
    'cursor: se-resize;',
    'fill: #aaa;',
  '}',

  '.blocklyResizeSW {',
    'cursor: sw-resize;',
    'fill: #aaa;',
  '}',

  '.blocklyResizeLine {',
    'stroke: #888;',
    'stroke-width: 1;',
  '}',

  '.blocklyHighlightedConnectionPath {',
    'fill: none;',
    'stroke: #fc3;',
    'stroke-width: 4px;',
  '}',

  '.blocklyPath {',
    'stroke-width: 1px;',
  '}',

  '.blocklySelected>.blocklyPath {',
    // 'stroke: #fc3;',
    // 'stroke-width: 3px;',
  '}',

  // Outline highlight on every selected block, regardless of shape.
  // Restrict to .blocklyBlockBackground so only the block's own main path is
  // stroked: an input's empty-socket outline path (core/input.js) carries the
  // bare .blocklyPath class without .blocklyBlockBackground, so it must NOT pick
  // up the box-select outline. Nested value/statement child blocks keep their
  // highlight because their main path does carry .blocklyBlockBackground.
  '.blocklyBoxSelected>.blocklyPath.blocklyBlockBackground {',
    'stroke: var(--blockly-select-stroke);',
    'stroke-width: 2px;',
  '}',

  // Fill highlight: the selected block's OWN fill, darkened, so it reads as a
  // "pressed/selected" state while keeping its category colour. Direct-child
  // selector only (svgGroup_ carries .blocklyBoxFill), so a block's interior
  // nested blocks are NOT recoloured — their own main path is not a direct child
  // of this group. C / loop headers are now included too: their path frames the
  // body as a hole, so only the frame tints (WorkspaceSvg.setBoxSelectStyle,
  // 2026-10-18). Very light blocks (luma > 200, e.g. white input shadows) opt out
  // in setBoxSelectStyle and keep their original fill, which is what stops the
  // grey fill that used to appear on input shadows during a rubber-band drag.
  // The value is published as --blockly-select-fill by BlockSvg.setBoxSelectStyle
  // / WorkspaceSvg.getBoxSelectColors_.
  '.blocklyBoxFill>.blocklyPath.blocklyBlockBackground {',
    'fill: var(--blockly-select-fill);',
  '}',

  // An empty value-input outline (the notch of an `if` block's empty boolean
  // socket, core/block_svg.js setBoxSelectStyle paintInputOutline) gets the same
  // highlight as its holding block while box-selected. The stroke colour is
  // inherited from the ancestor .blocklyBoxSelected group's
  // --blockly-select-stroke custom property. stroke-width is forced to 2px with
  // !important (user request 2026-10-18) so the selected empty-socket border is
  // never overridden by other styling.
  '.blocklyBoxInputOutline {',
    'stroke: var(--blockly-select-stroke) !important;',
    'stroke-width: 2px !important;',
  '}',

  // NOTE: do NOT add a descendant ".blocklyBoxSelected .blocklyBlockBackground"
  // rule here. In this fork each block's svg group is nested inside its parent
  // block group, so a descendant selector would also match the (still
  // unselected) nested blocks sitting inside a selected C / loop block, and the
  // --blockly-select-stroke custom property inherited from the ancestor
  // .blocklyBoxSelected group would recolor their borders. The selected block's
  // own path already carries blocklyBlockBackground and is covered by the
  // direct-child .blocklyBoxSelected>.blocklyPath rule above.

  '.blocklySelected>.blocklyPathLight {',
    'display: none;',
  '}',

  '.blocklyBoxSelectRect {',
    'fill: rgba(76, 151, 255, 0.2);',
    'stroke: #4c97ff;',
    'stroke-width: 1px;',
    'pointer-events: none;',
  '}',

  '.blocklyDraggable {',
    /* backup for browsers (e.g. IE11) that don't support grab */
    'cursor: url("<<<PATH>>>/handopen.cur"), auto;',
    'cursor: grab;',
    'cursor: -webkit-grab;',
    'cursor: -moz-grab;',
  '}',

   '.blocklyDragging {',
    /* backup for browsers (e.g. IE11) that don't support grabbing */
    'cursor: url("<<<PATH>>>/handclosed.cur"), auto;',
    'cursor: grabbing;',
    'cursor: -webkit-grabbing;',
    'cursor: -moz-grabbing;',
  '}',
  /* Changes cursor on mouse down. Not effective in Firefox because of
    https://bugzilla.mozilla.org/show_bug.cgi?id=771241 */
  '.blocklyDraggable:active {',
    /* backup for browsers (e.g. IE11) that don't support grabbing */
    'cursor: url("<<<PATH>>>/handclosed.cur"), auto;',
    'cursor: grabbing;',
    'cursor: -webkit-grabbing;',
    'cursor: -moz-grabbing;',
  '}',
  /* Change the cursor on the whole drag surface in case the mouse gets
     ahead of block during a drag. This way the cursor is still a closed hand.
   */
  '.blocklyBlockDragSurface .blocklyDraggable {',
    /* backup for browsers (e.g. IE11) that don't support grabbing */
    'cursor: url("<<<PATH>>>/handclosed.cur"), auto;',
    'cursor: grabbing;',
    'cursor: -webkit-grabbing;',
    'cursor: -moz-grabbing;',
  '}',

  '.blocklyDragging.blocklyDraggingDelete {',
    'cursor: url("<<<PATH>>>/handdelete.cur"), auto;',
  '}',

  '.blocklyDragging.blocklyDraggingMouseThrough {',
    'pointer-events: none;',
  '}',

  '.blocklyToolboxDelete {',
    'cursor: url("<<<PATH>>>/handdelete.cur"), auto;',
  '}',

  '.blocklyToolboxGrab {',
    'cursor: url("<<<PATH>>>/handclosed.cur"), auto;',
    'cursor: grabbing;',
    'cursor: -webkit-grabbing;',
  '}',

  '.blocklyDragging>.blocklyPath,',
  '.blocklyDragging>.blocklyPathLight {',
    'fill-opacity: 1.0;',
    'stroke-opacity: 1.0;',
  '}',

  '.blocklyDragging>.blocklyPath {',
  '}',

  '.blocklyDisabled>.blocklyPath {',
    'fill-opacity: .5;',
    'stroke-opacity: .5;',
  '}',

  '.blocklyInsertionMarker>.blocklyPath {',
    'stroke: none;',
  '}',

  '.blocklyText {',
    'fill: $colour_text;',
    'font-family: "Helvetica Neue", Helvetica, sans-serif;',
    'font-size: 12pt;',
    'font-weight: 500;',
  '}',

  '.blocklyTextTruncated {',
    'font-size: 11pt;',
  '}',

  '.blocklyNonEditableText>text {',
    'pointer-events: none;',
  '}',
  '.blocklyNonEditableText>text,',
  '.blocklyEditableText>text {',
    'fill: $colour_textFieldText;',
  '}',

  '.blocklyEditableText>.blocklyEditableLabel {',
    'fill: #fff;',
  '}',

  '.blocklyDropdownText {',
    'fill: $colour_text !important;',
  '}',

  '.blocklyBubbleText {',
    'fill: $colour_textFieldText;',
  '}',
  '.blocklyFlyout {',
    'position: absolute;',
    'z-index: 20;',
  '}',
  '.blocklyFlyoutButton {',
    'fill: none;',
    'pointer-events: all;',
  '}',

  '.blocklyFlyoutButtonBackground {',
    'stroke: $colour_buttonBorder;',
  '}',

  '.blocklyFlyoutButton .blocklyText {',
    'fill: $colour_buttonForeground;',
  '}',

  '.blocklyFlyoutButtonShadow {',
    'fill: transparent;',
  '}',

  '.blocklyFlyoutButton:hover {',
    'fill: $colour_buttonActiveBackground;',
    'cursor: pointer;',
  '}',

  '.blocklyFlyoutLabel {',
    'cursor: default;',
  '}',

  '.blocklyFlyoutLabelBackground {',
    'opacity: 0;',
  '}',

  '.blocklyTouchTargetBackground {',
    'fill: transparent;',
    'cursor: pointer;',
  '}',

  '.blocklyFlyoutLabelText {',
    'font-family: "Helvetica Neue", Helvetica, sans-serif;',
    'font-size: 14pt;',
    'fill: $colour_flyoutLabelColor;',
    'font-weight: bold;',
  '}',

  /*
    Don't allow users to select text.  It gets annoying when trying to
    drag a block and selected text moves instead.
  */
  '.blocklySvg text, .blocklyBlockDragSurface text, .blocklyFlyout text, .blocklyToolboxDiv text {',
    'user-select: none;',
    '-moz-user-select: none;',
    '-webkit-user-select: none;',
    'cursor: inherit;',
  '}',

  '.blocklyHidden {',
    'display: none;',
  '}',

  '.blocklyFieldDropdown:not(.blocklyHidden) {',
    'display: block;',
  '}',

  '.blocklyIconGroup {',
    'cursor: default;',
  '}',

  '.blocklyIconGroup:not(:hover),',
  '.blocklyIconGroupReadonly {',
    'opacity: .6;',
  '}',

  '.blocklyIconShape {',
    'fill: #00f;',
    'stroke: #fff;',
    'stroke-width: 1px;',
  '}',

  '.blocklyIconSymbol {',
    'fill: #fff;',
  '}',

  '.blocklyMinimalBody {',
    'margin: 0;',
    'padding: 0;',
  '}',

  '.blocklyCommentForeignObject {',
    'position: relative;',
    'z-index: 0;',
  '}',

  '.blocklyCommentRect {',
    'fill: #E7DE8E;',
    'stroke: #bcA903;',
    'stroke-width: 1px',
  '}',

  '.blocklyCommentTarget {',
    'fill: transparent;',
    'stroke: #bcA903;',
  '}',

  '.blocklyCommentTargetFocused {',
    'fill: none;',
  '}',

  '.blocklyCommentHandleTarget {',
    'fill: none;',
  '}',

  '.blocklyCommentHandleTargetFocused {',
    'fill: transparent;',
  '}',

  '.blocklyFocused>.blocklyCommentRect {',
    'fill: #B9B272;',
    'stroke: #B9B272;',
  '}',

  '.blocklySelected>.blocklyCommentTarget {',
    'stroke: #fc3;',
    'stroke-width: 3px;',
  '}',


  '.blocklyCommentTextarea {',
    'background-color: #fef49c;',
    'border: 0;',
    'outline: 0;',
    'margin: 0;',
    'padding: 3px;',
    'resize: none;',
    'display: block;',
    'overflow: hidden;',
  '}',

  '.blocklyCommentDeleteIcon {',
    'cursor: pointer;',
    'fill: #000;',
    'display: none',
  '}',

  '.blocklySelected > .blocklyCommentDeleteIcon {',
    'display: block',
  '}',

  '.blocklyDeleteIconShape {',
    'fill: #000;',
    'stroke: #000;',
    'stroke-width: 1px;',
  '}',

  '.blocklyDeleteIconShape.blocklyDeleteIconHighlighted {',
    'stroke: #fc3;',
  '}',

  // Scratch Comments

  '.scratchCommentForeignObject {',
    'position: relative;',
  '}',

  '.scratchCommentBody {',
    'background-color: #fef49c;',
    'border-radius: 4px;',
  '}',

  '.scratchCommentRect {',
    'fill: #fef49c;',
  '}',

  '.scratchWorkspaceCommentBorder {',
    'stroke: #bcA903;',
    'stroke-width: 1px;',
  '}',

  '.scratchCommentTopBar {',
    'fill: #000000;',
    'fill-opacity: 0.1',
  '}',

  '.blocklyFrameIcon {',
    'cursor: pointer;',
  '}',

  '.blocklyFrameTitle {',
    'pointer-events: none;',
    'user-select: none;',
  '}',

  '.blocklyFrameForeignObject body {',
    'background: none;',
    'margin: 0;',
  '}',

  '.blocklyFrameTitleInput {',
    'background: none;',
    'border: none;',
    'outline: none;',
    'padding: 0;',
    'width: 100%;',
    'height: 32px;',
  '}',

  '.scratchCommentText {',
    'color: black;',
    'font-family: "Helvetica Neue", Helvetica, sans-serif;',
    'font-size: 12pt;',
    'font-weight: 400;',
  '}',

  '.scratchCommentTextarea {',
    'background-color: transparent;',
    'border: 0;',
    'outline: 0;',
    'padding: 0;',
    'resize: none;',
  '}',

  '.scratchCommentTextarea::placeholder {',
    'color: rgba(0,0,0,0.5);',
    'font-style: italic;',
  '}',

  '.scratchCommentResizeSE {',
    'cursor: se-resize;',
    'fill: transparent;',
  '}',

  '.scratchCommentResizeSW {',
    'cursor: sw-resize;',
    'fill: transparent;',
  '}',

  '.blocklyHtmlInput {',
    'border: none;',
    'font-family: "Helvetica Neue", Helvetica, sans-serif;',
    'font-size: 12pt;',
    'height: 100%;',
    'margin: 0;',
    'outline: none;',
    'box-sizing: border-box;',
    'width: 100%;',
    'text-align: center;',
    'color: $colour_textFieldText;',
    'background-color: $colour_textField;',
    'font-weight: 500;',
    'color-scheme: light;',
  '}',

  '.blocklyMainBackground {',
    'stroke-width: 1;',
    'stroke: #c6c6c6;',  /* Equates to #ddd due to border being off-pixel. */
  '}',

  '.blocklyMutatorBackground {',
    'fill: #fff;',
    'stroke: #ddd;',
    'stroke-width: 1;',
  '}',

  '.blocklyFlyoutBackground {',
    'fill: $colour_flyout;',
    'fill-opacity: .8;',
  '}',

  '.blocklyMainWorkspaceScrollbar {',
    'z-index: 20;',
  '}',

  '.blocklyFlyoutScrollbar {',
    'z-index: 30;',
  '}',

  '.blocklyScrollbarHorizontal, .blocklyScrollbarVertical {',
    'position: absolute;',
    'outline: none;',
  '}',

  '.blocklyScrollbarBackground {',
    'opacity: 0;',
  '}',

  '.blocklyScrollbarHandle {',
    'fill: $colour_scrollbar;',
  '}',

  '.blocklyScrollbarBackground:hover+.blocklyScrollbarHandle,',
  '.blocklyScrollbarHandle:hover {',
    'fill: $colour_scrollbarHover;',
  '}',

  '.blocklyZoom>image {',
    'opacity: 1;',
    'filter: $colour_zoomIconFilter;',
  '}',

  /* Darken flyout scrollbars due to being on a grey background. */
  /* By contrast, workspace scrollbars are on a white background. */
  '.blocklyFlyout .blocklyScrollbarHandle {',
    'fill: #bbb;',
  '}',

  '.blocklyFlyout .blocklyScrollbarBackground:hover+.blocklyScrollbarHandle,',
  '.blocklyFlyout .blocklyScrollbarHandle:hover {',
    'fill: #aaa;',
  '}',

  '.blocklyInvalidInput {',
    'background: #faa;',
  '}',

  '.blocklyAngleCircle {',
    'stroke-width: 1;',
  '}',

  '.blocklyAngleCenterPoint {',
    'stroke: #fff;',
    'stroke-width: 1;',
    'fill: #fff;',
  '}',

  '.blocklyAngleDragHandle {',
    'stroke: #fff;',
    'stroke-width: 5;',
    'stroke-opacity: 0.25;',
    'fill: #fff;',
    'cursor: pointer;',
  '}',

  '.blocklyAngleDragArrow {',
    'pointer-events: none',
  '}',

  '.blocklyAngleMarks {',
    'stroke: #fff;',
    'stroke-width: 1;',
    'stroke-opacity: 0.5;',
  '}',

  '.blocklyAngleGauge {',
    'fill: #fff;',
    'fill-opacity: 0.20;',
  '}',

  '.blocklyAngleLine {',
    'stroke: #fff;',
    'stroke-width: 1;',
    'stroke-linecap: round;',
    'pointer-events: none;',
  '}',

  '.blocklyContextMenu {',
    'border-radius: 10px;',
    'max-height: 100%;',
  '}',

  '.blocklyDropdownMenu {',
    'padding: 0 !important;',
  '}',

  '.blocklyDropDownNumPad {',
    'background-color: $colour_numPadBackground;',
  '}',

  /* Override the default Closure URL. */
  '.blocklyWidgetDiv .goog-option-selected .goog-menuitem-checkbox,',
  '.blocklyWidgetDiv .goog-option-selected .goog-menuitem-icon {',
    'background: url(<<<PATH>>>/sprites.png) no-repeat -48px -16px !important;',
  '}',

  /* Category tree in Toolbox. */
  '.blocklyToolboxDiv {',
    'background-color: $colour_toolbox;',
    'color: $colour_toolboxText;',
    'overflow-x: visible;',
    'overflow-y: auto;',
    'position: absolute;',
    'font-family: "Helvetica Neue", Helvetica, sans-serif;',
    'z-index: 40;', /* so blocks go over toolbox when dragging */
    '-webkit-tap-highlight-color: transparent;', /* issue #1345 */
  '}',

  '.blocklyTreeRoot {',
    'padding: 4px 0;',
  '}',

  '.blocklyTreeRoot:focus {',
    'outline: none;',
  '}',

  '.blocklyTreeRow {',
    'height: 22px;',
    'line-height: 22px;',
    'margin-bottom: 3px;',
    'padding-right: 8px;',
    'white-space: nowrap;',
  '}',

  '.blocklyHorizontalTree {',
    'float: left;',
    'margin: 1px 5px 8px 0;',
  '}',

  '.blocklyHorizontalTreeRtl {',
    'float: right;',
    'margin: 1px 0 8px 5px;',
  '}',

  '.blocklyToolboxDiv[dir="RTL"] .blocklyTreeRow {',
    'margin-left: 8px;',
  '}',

  '.blocklyTreeRow:not(.blocklyTreeSelected):hover {',
    'background-color: #e4e4e4;',
  '}',

  '.blocklyTreeSeparator {',
    'border-bottom: solid #e5e5e5 1px;',
    'height: 0;',
    'margin: 5px 0;',
  '}',

  '.blocklyTreeSeparatorHorizontal {',
    'border-right: solid #e5e5e5 1px;',
    'width: 0;',
    'padding: 5px 0;',
    'margin: 0 5px;',
  '}',

  '.blocklyTreeIcon {',
    'background-image: url(<<<PATH>>>/sprites.png);',
    'height: 16px;',
    'vertical-align: middle;',
    'width: 16px;',
  '}',

  '.blocklyTreeIconClosedLtr {',
    'background-position: -32px -1px;',
  '}',

  '.blocklyTreeIconClosedRtl {',
    'background-position: 0px -1px;',
  '}',

  '.blocklyTreeIconOpen {',
    'background-position: -16px -1px;',
  '}',

  '.blocklyTreeSelected>.blocklyTreeIconClosedLtr {',
    'background-position: -32px -17px;',
  '}',

  '.blocklyTreeSelected>.blocklyTreeIconClosedRtl {',
    'background-position: 0px -17px;',
  '}',

  '.blocklyTreeSelected>.blocklyTreeIconOpen {',
    'background-position: -16px -17px;',
  '}',

  '.blocklyTreeIconNone,',
  '.blocklyTreeSelected>.blocklyTreeIconNone {',
    'background-position: -48px -1px;',
  '}',

  '.blocklyTreeLabel {',
    'cursor: default;',
    'font-family: "Helvetica Neue", Helvetica, sans-serif;',
    'font-size: 16px;',
    'padding: 0 3px;',
    'vertical-align: middle;',
  '}',

  '.blocklyToolboxDelete .blocklyTreeLabel {',
    'cursor: url("<<<PATH>>>/handdelete.cur"), auto;',
  '}',

  '.blocklyTreeSelected .blocklyTreeLabel {',
    'color: #fff;',
  '}',

  '.blocklyDropDownDiv .goog-slider-horizontal {',
    'margin: 8px;',
    'height: 22px;',
    'width: 150px;',
    'position: relative;',
    'outline: none;',
    'border-radius: 11px;',
    'margin-bottom: 20px;',
  '}',

  '.blocklyDropDownDiv .goog-slider-horizontal .goog-slider-thumb {',
    'width: 26px;',
    'height: 26px;',
    'top: -1px;',
    'position: absolute;',
    'background-color: white;',
    'border-radius: 100%;',
    '-webkit-box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.15);',
    '-moz-box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.15);',
    'box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.15);',
  '}',

  '.scratchEyedropper {',
    'background: none;',
    'outline: none;',
    'border: none;',
    'width: 100%;',
    'text-align: center;',
    'border-top: 1px solid $colour_valueReportBorder;',
    // The drop-down's arrow straddles the box edge, so its inner half reaches a
    // few pixels into the content: keep the icon that far off the bottom or the
    // arrow is drawn on top of it when the picker opens upwards. (2026-10-24)
    'padding: 5px 0 9px;',
    'cursor: pointer;',
  '}',

  '.scratchEyedropper img {',
    // Give the icon its intrinsic size up front. Without it the button has no
    // height until the SVG has been laid out, so the drop-down is measured
    // shorter than it renders and everything derived from that height -- the
    // arrow, the place the box is anchored -- is off by the difference.
    'width: 24px;',
    'height: 24px;',
    'vertical-align: middle;',
  '}',

  '.scratchColourPickerLabel {',
    'font-family: "Helvetica Neue", Helvetica, sans-serif;',
    'font-size: 0.65rem;',
    'color: $colour_valueReportForeground;',
    'margin: 8px;',
  '}',

  '.scratchColourPickerLabelText {',
    'font-weight: bold;',
  '}',

  '.scratchColourPickerReadout {',
    'margin-left: 10px;',
  '}',

  '.scratchMatrixButtonDiv {',
    'width: 50%;',
    'text-align: center;',
    'float: left;',
  '}',

  '.scratchNotePickerKeyLabel {',
    'font-family: "Helvetica Neue", Helvetica, sans-serif;',
    'font-size: 0.75rem;',
    'fill: $colour_blackText;',
    'pointer-events: none;',
  '}',

  /* Copied from: goog/css/menu.css */
  /*
   * Copyright 2009 The Closure Library Authors. All Rights Reserved.
   *
   * Use of this source code is governed by the Apache License, Version 2.0.
   * See the COPYING file for details.
   */

  /**
   * Standard styling for menus created by goog.ui.MenuRenderer.
   *
   * @author attila@google.com (Attila Bodis)
   */

  '.blocklyWidgetDiv .goog-menu {',
    'box-shadow: 0px 0px 5px 1px rgba(0, 0, 0, 0.2);',
    'background: $colour_contextMenuBackground;',
    'border-color: $colour_contextMenuBorder;',
    'color: $colour_contextMenuForeground;',
    'border-style: solid;',
    'border-width: 1px;',
    'cursor: default;',
    'font: normal 13px "Helvetica Neue", Helvetica, sans-serif;',
    'margin: 0;',
    'outline: none;',
    'padding: 7px 0;',
    'position: absolute;',
    'overflow-y: auto;',
    'overflow-x: hidden;',
    'z-index: 20000;',  /* Arbitrary, but some apps depend on it... */
  '}',

  '.blocklyDropDownDiv .goog-menu {',
    'cursor: default;',
    'font: normal 13px "Helvetica Neue", Helvetica, sans-serif;',
    'outline: none;',
    'z-index: 20000;',  /* Arbitrary, but some apps depend on it... */
  '}',

  /* Copied from: goog/css/menuitem.css */
  /*
   * Copyright 2009 The Closure Library Authors. All Rights Reserved.
   *
   * Use of this source code is governed by the Apache License, Version 2.0.
   * See the COPYING file for details.
   */

  /**
   * Standard styling for menus created by goog.ui.MenuItemRenderer.
   *
   * @author attila@google.com (Attila Bodis)
   */

  /**
   * State: resting.
   *
   * NOTE(mleibman,chrishenry):
   * The RTL support in Closure is provided via two mechanisms -- "rtl" CSS
   * classes and BiDi flipping done by the CSS compiler.  Closure supports RTL
   * with or without the use of the CSS compiler.  In order for them not
   * to conflict with each other, the "rtl" CSS classes need to have the #noflip
   * annotation.  The non-rtl counterparts should ideally have them as well, but,
   * since .goog-menuitem existed without .goog-menuitem-rtl for so long before
   * being added, there is a risk of people having templates where they are not
   * rendering the .goog-menuitem-rtl class when in RTL and instead rely solely
   * on the BiDi flipping by the CSS compiler.  That's why we're not adding the
   * #noflip to .goog-menuitem.
   */
  '.blocklyWidgetDiv .goog-menuitem {',
    'font: normal 13px "Helvetica Neue", Helvetica, sans-serif;',
    'list-style: none;',
    'margin: 0;',
     /* 28px on the left for icon or checkbox; 7em on the right for shortcut. */
    /* Keep the 1px top/bottom borders in the resting state (transparent), so
     * highlighting an item never changes its box. At non-100% browser zoom
     * hairline borders are snapped to device pixels; adding/removing them on
     * hover used to make the hovered item, and therefore the whole menu, jump
     * in height as the pointer moved. */
    'border-color: transparent;',
    'border-style: dotted;',
    'border-width: 1px 0;',
    'padding: 6px 7em 6px 28px;',
    'white-space: nowrap;',
  '}',

  '.blocklyDropDownDiv .goog-menuitem {',
    'color: $colour_text;',
    'font: normal 13px "Helvetica Neue", Helvetica, sans-serif;',
    'font-weight: bold;',
    'list-style: none;',
    'margin: 0;',
    'min-height: 24px;',
     /* 28px on the left for icon or checkbox; 7em on the right for shortcut. */
    'padding: 7px 7em 7px 28px;',
    'white-space: nowrap;',
  '}',

  /* BiDi override for the resting state. */
  /* #noflip */
  '.blocklyWidgetDiv .goog-menuitem.goog-menuitem-rtl, ',
  '.blocklyDropDownDiv .goog-menuitem.goog-menuitem-rtl {',
     /* Flip left/right padding for BiDi. */
    'padding-left: 7em;',
    'padding-right: 28px;',
  '}',

  /* If a menu doesn't have checkable items or items with icons, remove padding. */
  '.blocklyWidgetDiv .goog-menu-nocheckbox .goog-menuitem,',
  '.blocklyWidgetDiv .goog-menu-noicon .goog-menuitem, ',
  '.blocklyDropDownDiv .goog-menu-nocheckbox .goog-menuitem,',
  '.blocklyDropDownDiv .goog-menu-noicon .goog-menuitem { ',
    'padding-left: 12px;',
  '}',

  /*
   * If a menu doesn't have items with shortcuts, leave just enough room for
   * submenu arrows, if they are rendered.
   */
  '.blocklyWidgetDiv .goog-menu-noaccel .goog-menuitem, ',
  '.blocklyDropDownDiv .goog-menu-noaccel .goog-menuitem {',
    'padding-right: 20px;',
  '}',

  '.blocklyWidgetDiv .goog-menuitem-content ',
  '.blocklyDropDownDiv .goog-menuitem-content {',
    'color: #000;',
    'font: normal 13px "Helvetica Neue", Helvetica, sans-serif;',
  '}',

  /* State: disabled. */
  '.blocklyWidgetDiv .goog-menuitem-disabled .goog-menuitem-accel,',
  '.blocklyWidgetDiv .goog-menuitem-disabled .goog-menuitem-content, ',
  '.blocklyDropDownDiv .goog-menuitem-disabled .goog-menuitem-accel,',
  '.blocklyDropDownDiv .goog-menuitem-disabled .goog-menuitem-content {',
    'color: $colour_contextMenuDisabledForeground !important;',
  '}',

  '.blocklyWidgetDiv .goog-menuitem-disabled .goog-menuitem-icon, ',
  '.blocklyDropDownDiv .goog-menuitem-disabled .goog-menuitem-icon {',
    'opacity: 0.3;',
    '-moz-opacity: 0.3;',
    'filter: alpha(opacity=30);',
  '}',

  /* State: hover. */
  '.blocklyWidgetDiv .goog-menuitem-highlight,',
  '.blocklyWidgetDiv .goog-menuitem-hover {',
    'background-color: $colour_contextMenuActiveBackground;',
     /* The borders are always present (transparent while resting); only their
      * colour changes here, so the item's height is identical in every state.
      * Real borders also keep the selection visible in high contrast mode. */
    'border-color: $colour_contextMenuActiveBackground;',
  '}',

  '.blocklyDropDownDiv .goog-menuitem-highlight,',
  '.blocklyDropDownDiv .goog-menuitem-hover {',
    'background-color: $colour_menuHover;',
  '}',

  /* State: selected/checked. */
  '.blocklyWidgetDiv .goog-menuitem-checkbox,',
  '.blocklyWidgetDiv .goog-menuitem-icon, ',
  '.blocklyDropDownDiv .goog-menuitem-checkbox,',
  '.blocklyDropDownDiv .goog-menuitem-icon {',
    'background-repeat: no-repeat;',
    'height: 16px;',
    'left: 6px;',
    'position: absolute;',
    'right: auto;',
    'vertical-align: middle;',
    'width: 16px;',
  '}',

  '.blocklyWidgetDiv .goog-option-selected .goog-menuitem-checkbox,',
  '.blocklyWidgetDiv .goog-option-selected .goog-menuitem-icon,',
  '.blocklyDropDownDiv .goog-option-selected .goog-menuitem-checkbox,',
  '.blocklyDropDownDiv .goog-option-selected .goog-menuitem-icon {',
     /* Client apps may override the URL at which they serve the sprite. */
    'background: url(<<<PATH>>>/sprites.png) no-repeat -48px -16px !important;',
    'position: static;', /* Scroll with the menu. */
    'float: left;',
    'margin-left: -24px;',
  '}',

  /* BiDi override for the selected/checked state. */
  /* #noflip */
  '.blocklyWidgetDiv .goog-menuitem-rtl .goog-menuitem-checkbox,',
  '.blocklyWidgetDiv .goog-menuitem-rtl .goog-menuitem-icon,',
  '.blocklyDropDownDiv .goog-menuitem-rtl .goog-menuitem-checkbox,',
  '.blocklyDropDownDiv .goog-menuitem-rtl .goog-menuitem-icon {',
     /* Flip left/right positioning. */
     'float: right;',
     'margin-right: -24px;',
  '}',

  /* Keyboard shortcut ("accelerator") style. */
  '.blocklyWidgetDiv .goog-menuitem-accel, ',
  '.blocklyDropDownDiv .goog-menuitem-accel {',
    'color: #999;',
     /* Keyboard shortcuts are untranslated; always left-to-right. */
     /* #noflip */
    'direction: ltr;',
    'left: auto;',
    'padding: 0 6px;',
    'position: absolute;',
    'right: 0;',
    'text-align: right;',
  '}',

  /* BiDi override for shortcut style. */
  /* #noflip */
  '.blocklyWidgetDiv .goog-menuitem-rtl .goog-menuitem-accel, ',
  '.blocklyDropDownDiv .goog-menuitem-rtl .goog-menuitem-accel {',
     /* Flip left/right positioning and text alignment. */
    'left: 0;',
    'right: auto;',
    'text-align: left;',
  '}',

  /* Mnemonic styles. */
  '.blocklyWidgetDiv .goog-menuitem-mnemonic-hint, ',
  '.blocklyDropDownDiv .goog-menuitem-mnemonic-hint {',
    'text-decoration: underline;',
  '}',

  '.blocklyWidgetDiv .goog-menuitem-mnemonic-separator, ',
  '.blocklyDropDownDiv .goog-menuitem-mnemonic-separator {',
    'color: #999;',
    'font-size: 12px;',
    'padding-left: 4px;',
  '}',

  /* Copied from: goog/css/menuseparator.css */
  /*
   * Copyright 2009 The Closure Library Authors. All Rights Reserved.
   *
   * Use of this source code is governed by the Apache License, Version 2.0.
   * See the COPYING file for details.
   */

  /**
   * Standard styling for menus created by goog.ui.MenuSeparatorRenderer.
   *
   * @author attila@google.com (Attila Bodis)
   */

  '.blocklyWidgetDiv .goog-menuseparator, ',
  '.blocklyDropDownDiv .goog-menuseparator {',
    'border-top: 1px solid #ccc;',
    'margin: 4px 0;',
    'padding: 0;',
  '}',

  '.blocklyFlyoutCheckbox {',
    'fill: $colour_checkboxInactiveBackground;',
    'stroke: $colour_checkboxInactiveBorder;',
  '}',

  /* Transitions are enabled by VerticalFlyout.createCheckbox_ one frame after
     the checkbox is inserted. Without that delay every already-checked box in
     a freshly opened category would animate its checkmark into place. */
  '.blocklyFlyoutCheckboxAnim > .blocklyFlyoutCheckbox {',
    'transition: fill .18s ease, stroke .18s ease;',
  '}',

  '.checked > .blocklyFlyoutCheckbox {',
    'fill: $colour_checkboxActiveBackground;',
    'stroke: $colour_checkboxActiveBorder;',
  '}',

  '.blocklyFlyoutCheckboxPath {',
    'fill: transparent;',
    'stroke: transparent;',
    'stroke-width: 3;',
    'stroke-linecap: round;',
    'stroke-linejoin: round;',
    /* CHECKMARK_PATH is ~17.7 units long for CHECKBOX_SIZE=25; 20 covers it
       fully. Offsetting the dash hides the mark, so toggling draws or erases
       the tick instead of just fading it in. */
    'stroke-dasharray: 20;',
    'stroke-dashoffset: 20;',
  '}',

  '.blocklyFlyoutCheckboxAnim > .blocklyFlyoutCheckboxPath {',
    'transition: stroke-dashoffset .22s cubic-bezier(.4, 0, .2, 1), stroke .16s ease;',
  '}',

  '.checked > .blocklyFlyoutCheckboxPath {',
    'stroke: $colour_checkboxCheck;',
    'stroke-dashoffset: 0;',
  '}',

  '@media (prefers-reduced-motion: reduce) {',
    '.blocklyFlyoutCheckboxAnim > .blocklyFlyoutCheckbox,',
    '.blocklyFlyoutCheckboxAnim > .blocklyFlyoutCheckboxPath {',
      'transition: none;',
    '}',
  '}',

  '.scratchCategoryMenu {',
    'width: 60px;',
    'background: $colour_toolbox;',
    'color: $colour_toolboxText;',
    'font-size: .7rem;',
    'user-select: none;',
    '-webkit-user-select: none;',
    '-moz-user-select: none;',
    '-ms-user-select: none;',
  '}',

  '.scratchCategoryMenuHorizontal {',
    'width: 100%;',
    'height: 50px;',
    'background: $colour_toolbox;',
    'color: $colour_toolboxText;',
    'font-size: .7em;',
    'user-select: none;',
    '-webkit-user-select: none;',
    '-moz-user-select: none;',
    '-ms-user-select: none;',
  '}',

  '.scratchCategoryMenuHorizontal .scratchCategoryMenuRow {',
    'float: left;',
    'margin: 3px;',
  '}',

  '.scratchCategoryMenuRow {',
  '}',

  '.scratchCategoryMenuItem {',
    'padding: 0.375rem 0px;',
    'cursor: pointer;',
    'text-align: center;',
  '}',

  '.scratchCategoryMenuHorizontal .scratchCategoryMenuItem {',
    'padding: 6px 5px;',
  '}',

  '.scratchCategoryMenuItem.categorySelected {',
    'background: $colour_toolboxSelected;',
  '}',

  '.scratchCategoryItemBubble {',
    'width: 1.25rem;',
    'height: 1.25rem;',
    'border: 1px solid;',
    'border-radius: 100%;',
    'margin: 0 auto 0.125rem;',
  '}',

  '.scratchCategoryItemIcon {',
    'width: 1.25rem;',
    'height: 1.25rem;',
    'margin: 0 auto 0.125rem;',
    'background-size: 100%;',
  '}',

  '.scratchCategoryMenuItem:hover {',
    'color: $colour_toolboxHover !important;',
  '}',

  /* FieldDropdown option list. The stock Closure rules above were written for
     desktop context menus: an accelerator column, a sprite checkmark and
     square grey separators. Scope every override to DropDownDiv so the
     right-click menu keeps its own theme. */
  /* One box for every item, including the RTL / noaccel / nocheckbox variants
     defined above. A permanent transparent border keeps resting and hover
     boxes identical, so non-100% browser zoom cannot make items jump. */
  '.blocklyDropDownDiv .goog-menu .goog-menuitem {',
    'padding: 5px 16px 5px 32px;',
    'min-height: 24px;',
    'border: 1px solid transparent;',
    'border-radius: 4px;',
    'margin: 1px 2px;',
    'transition: background-color .12s ease;',
  '}',

  '.blocklyDropDownDiv .goog-menu .goog-menuitem.goog-menuitem-rtl {',
    'padding: 5px 32px 5px 16px;',
  '}',

  /* The inherited Closure rule hard-codes #000 on the content span, which
     overrides the themed colour set on the item itself. */
  '.blocklyDropDownDiv .goog-menu .goog-menuitem-content {',
    'color: $colour_text;',
    'line-height: 18px;',
  '}',

  /* Replace the sprite tick with a CSS one in the menu's own text colour so it
     stays legible on every category / custom-theme background. */
  '.blocklyDropDownDiv .goog-menu .goog-option-selected .goog-menuitem-checkbox,',
  '.blocklyDropDownDiv .goog-menu .goog-option-selected .goog-menuitem-icon {',
    'background: none !important;',
    'position: relative;',
    /* The shared Closure rule sets left:6px for the absolute resting state.
       With position:relative that offset still applies and pushes the tick
       right; zero it, then pull the whole check further into the gutter. */
    'left: 0;',
    'right: 0;',
    /* 'margin-left: -28px;', */
  '}',

  '.blocklyDropDownDiv .goog-menu .goog-menuitem-rtl.goog-option-selected .goog-menuitem-checkbox,',
  '.blocklyDropDownDiv .goog-menu .goog-menuitem-rtl.goog-option-selected .goog-menuitem-icon {',
    'margin-left: 0;',
    'margin-right: -28px;',
  '}',

  '.blocklyDropDownDiv .goog-menu .goog-option-selected .goog-menuitem-checkbox::after,',
  '.blocklyDropDownDiv .goog-menu .goog-option-selected .goog-menuitem-icon::after {',
    'content: "";',
    'position: absolute;',
    'left: 4px;',
    'top: 1px;',
    'width: 5px;',
    'height: 9px;',
    'border: solid $colour_text;',
    'border-width: 0 2px 2px 0;',
    'transform: rotate(45deg);',
  '}',

  '.blocklyDropDownDiv .goog-menu .goog-menuitem-rtl.goog-option-selected .goog-menuitem-checkbox::after {',
    'left: auto;',
    'right: 4px;',
  '}',

  '.blocklyDropDownDiv .goog-menu .goog-menuseparator {',
    'border-top: 1px solid $colour_menuHover;',
    'margin: 4px 8px;',
  '}',

  /* The list scrolls with the native scrollbar; make it match the thin,
     theme-aware scrollbars used elsewhere instead of the OS default. */
  '.blocklyDropDownContent {',
    'scrollbar-width: thin;',
    'scrollbar-color: $colour_menuHover transparent;',
  '}',

  '.blocklyDropDownContent::-webkit-scrollbar {',
    'width: 8px;',
    'height: 8px;',
  '}',

  '.blocklyDropDownContent::-webkit-scrollbar-track {',
    'background: transparent;',
  '}',

  '.blocklyDropDownContent::-webkit-scrollbar-thumb {',
    'background: $colour_menuHover;',
    'border-radius: 4px;',
  '}',

  '@media (prefers-reduced-motion: reduce) {',
    '.blocklyDropDownDiv .goog-menu .goog-menuitem {',
      'transition: none;',
    '}',
  '}',
  ''
];
