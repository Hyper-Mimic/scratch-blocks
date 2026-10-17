/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2018 Google Inc.
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
 * @fileoverview Utility methods for Scratch Blocks but not Blockly.
 * @author fenichel@google.com (Rachel Fenichel)
 */
'use strict';

/**
 * @name Blockly.scratchBlocksUtils
 * @namespace
 **/
goog.provide('Blockly.scratchBlocksUtils');


/**
 * Measure some text using a canvas in-memory.
 * Does not exist in Blockly, but needed in scratch-blocks
 * @param {string} fontSize E.g., '10pt'
 * @param {string} fontFamily E.g., 'Arial'
 * @param {string} fontWeight E.g., '600'
 * @param {string} text The actual text to measure
 * @return {number} Width of the text in px.
 * @package
 */
Blockly.scratchBlocksUtils.measureText = function(fontSize, fontFamily,
    fontWeight, text) {
  var canvas = document.createElement('canvas');
  var context = canvas.getContext('2d');
  context.font = fontWeight + ' ' + fontSize + ' ' + fontFamily;
  return context.measureText(text).width;
};

/**
 * Re-assign obscured shadow blocks new IDs to prevent collisions
 * Scratch specific to help the VM handle deleting obscured shadows.
 * @param {Blockly.Block} block the root block to be processed.
 * @package
 */
Blockly.scratchBlocksUtils.changeObscuredShadowIds = function(block) {
  var blocks = block.getDescendants(false);
  for (var i = blocks.length - 1; i >= 0; i--) {
    var descendant = blocks[i];
    for (var j = 0; j < descendant.inputList.length; j++) {
      var connection = descendant.inputList[j].connection;
      if (connection) {
        var shadowDom = connection.getShadowDom();
        if (shadowDom) {
          shadowDom.setAttribute('id', Blockly.utils.genUid());
          connection.setShadowDom(shadowDom);
        }
      }
    }
  }
};

/**
 * Recursively assign fresh IDs to blocks, in-place.
 * @param {Element} xmlBlock The root XML
 */
Blockly.scratchBlocksUtils.changeCopiedBlockIds = function(xmlBlock) {
  var tagName = xmlBlock.tagName && xmlBlock.tagName.toLowerCase();
  if (tagName === 'block' || tagName === 'shadow') {
    xmlBlock.setAttribute('id', Blockly.utils.genUid());
  }
  for (var i = 0; i < xmlBlock.childNodes.length; i++) {
    var child = xmlBlock.childNodes[i];
    if (child.nodeType === 1) {
      Blockly.scratchBlocksUtils.changeCopiedBlockIds(child);
    }
  }
};

/**
 * Whether a block is both a shadow block and an argument reporter.  These
 * blocks have special behaviour in scratch-blocks: they're duplicated when
 * dragged, and they are rendered slightly differently from normal shadow
 * blocks.
 * @param {!Blockly.BlockSvg} block The block that should be used to make this
 *     decision.
 * @return {boolean} True if the block should be duplicated on drag.
 * @package
 */
Blockly.scratchBlocksUtils.isShadowArgumentReporter = function(block) {
  return (block.isShadow() && (block.type == 'argument_reporter_boolean' ||
      block.type == 'argument_reporter_string_number'));
};

/**
 * Compare strings with natural number sorting.
 * @param {string} str1 First input.
 * @param {string} str2 Second input.
 * @return {number} -1, 0, or 1 to signify greater than, equality, or less than.
 */
Blockly.scratchBlocksUtils.compareStrings = function(str1, str2) {
  return str1.localeCompare(str2, [], {
    sensitivity: 'base',
    numeric: true
  });
};

/**
 * Determine if this block can be recycled in the flyout.  Blocks that have no
 * variablees and are not dynamic shadows can be recycled.
 * @param {Blockly.Block} block The block to check.
 * @return {boolean} True if the block can be recycled.
 * @package
 */
Blockly.scratchBlocksUtils.blockIsRecyclable = function(block) {
  // If the block needs to parse mutations, never recycle.
  if (block.mutationToDom && block.domToMutation) {
    return false;
  }

  for (var i = 0; i < block.inputList.length; i++) {
    var input = block.inputList[i];
    for (var j = 0; j < input.fieldRow.length; j++) {
      var field = input.fieldRow[j];
      // No variables.
      if (field instanceof Blockly.FieldVariable ||
          field instanceof Blockly.FieldVariableGetter) {
        return false;
      }
      if (field instanceof Blockly.FieldDropdown ||
          field instanceof Blockly.FieldNumberDropdown ||
          field instanceof Blockly.FieldTextDropdown) {
        if (field.isOptionListDynamic()) {
          return false;
        }
      }
    }
    // Check children.
    if (input.connection) {
      var child = input.connection.targetBlock();
      if (child && !Blockly.scratchBlocksUtils.blockIsRecyclable(child)) {
        return false;
      }
    }
  }
  return true;
};


/**
 * Creates a callback function for a click on the "duplicate" context menu
 * option in Scratch Blocks.  The block is duplicated and attached to the mouse,
 * which acts as though it were pressed and mid-drag.  Clicking the mouse
 * releases the new dragging block.
 * @param {!Blockly.BlockSvg} oldBlock The block that will be duplicated.
 * @param {!Event} event Event that caused the context menu to open.
 * @return {Function} A callback function that duplicates the block and starts a
 *     drag.
 * @package
 */
Blockly.scratchBlocksUtils.duplicateAndDragCallback = function(oldBlock, event) {
  var isMouseEvent = Blockly.Touch.getTouchIdentifierFromEvent(event) === 'mouse';
  return function(e) {
    // Give the context menu a chance to close.
    setTimeout(function() {
      var ws = oldBlock.workspace;
      var svgRootOld = oldBlock.getSvgRoot();
      if (!svgRootOld) {
        throw new Error('oldBlock is not rendered.');
      }

      // Create the new block by cloning the block in the flyout (via XML).
      var xml = Blockly.Xml.blockToDom(oldBlock);
      // The target workspace would normally resize during domToBlock, which
      // will lead to weird jumps.
      // Resizing will be enabled when the drag ends.
      ws.setResizesEnabled(false);

      // Disable events and manually emit events after the block has been
      // positioned and has had its shadow IDs fixed (Scratch-specific).
      Blockly.Events.disable();
      try {
        // Using domToBlock instead of domToWorkspace means that the new block
        // will be placed at position (0, 0) in main workspace units.
        var newBlock = Blockly.Xml.domToBlock(xml, ws);

        // Scratch-specific: Give shadow dom new IDs to prevent duplicating on paste
        Blockly.scratchBlocksUtils.changeObscuredShadowIds(newBlock);

        var svgRootNew = newBlock.getSvgRoot();
        if (!svgRootNew) {
          throw new Error('newBlock is not rendered.');
        }

        // The position of the old block in workspace coordinates.
        var oldBlockPosWs = oldBlock.getRelativeToSurfaceXY();

        // Place the new block as the same position as the old block.
        // TODO: Offset by the difference between the mouse position and the upper
        // left corner of the block.
        newBlock.moveBy(oldBlockPosWs.x, oldBlockPosWs.y);
        if (!isMouseEvent) {
          var offsetX = ws.RTL ? -100 : 100;
          var offsetY = 100;
          newBlock.moveBy(offsetX, offsetY); // Just offset the block for touch.
        }
      } finally {
        Blockly.Events.enable();
      }
      if (Blockly.Events.isEnabled()) {
        Blockly.Events.fire(new Blockly.Events.BlockCreate(newBlock));
      }

      if (isMouseEvent) {
        // e is not a real mouseEvent/touchEvent/pointerEvent.  It's an event
        // created by the context menu and has the coordinates of the mouse
        // click that opened the context menu.
        var fakeEvent = {
          clientX: event.clientX,
          clientY: event.clientY,
          type: 'mousedown',
          preventDefault: function() {
            e.preventDefault();
          },
          stopPropagation: function() {
            e.stopPropagation();
          },
          target: e.target
        };
        ws.startDragWithFakeEvent(fakeEvent, newBlock);
      }
    }, 0);
  };
};

/**
 * Collect a block and everything that physically belongs to it as one unit: its
 * input/statement-nested children (recursively, including the next chains inside
 * statement bodies), but NOT the block's own next statement (the sibling block
 * below it on the stack).  Used so a box-selected block drags/duplicates exactly
 * that block and its contents — not the unselected blocks beneath it (2026-10-17).
 * @param {!Blockly.Block} block Block to start from.
 * @param {!Set<!Blockly.Block>} set Set to add the unit's blocks to.
 * @param {boolean} followNext Whether to also follow this block's next connection
 *     (true for blocks reached through an input/statement so a statement body's
 *     own continuation stays attached; false for the top selected block so its
 *     below-sibling is excluded).
 * @private
 */
Blockly.scratchBlocksUtils.collectUnit_ = function(block, set, followNext) {
  if (!block || set.has(block)) {
    return;
  }
  set.add(block);
  for (var i = 0, input; input = block.inputList[i]; i++) {
    if (input.connection) {
      var child = input.connection.targetBlock();
      if (child) {
        Blockly.scratchBlocksUtils.collectUnit_(child, set, true);
      }
    }
  }
  if (followNext && block.nextConnection) {
    var next = block.nextConnection.targetBlock();
    if (next) {
      Blockly.scratchBlocksUtils.collectUnit_(next, set, true);
    }
  }
};

/**
 * Remove every unselected block from a serialized block tree, in place, so a
 * duplicate matches the box selection exactly.  After Blockly.Xml.blockToDom
 * the XML still holds every block connected below/inside `head`; a box-select
 * gap (a deselected block between two selected stacked blocks, or a C block
 * kept while a block inside its body is deselected) would otherwise leak into
 * the copy.  The next / value / statement connections are all pruned:
 *   - a SHADOW child always travels with its container (it is the block's own
 *     default filler, never a separate selection unit), and is kept untouched;
 *   - a REAL child that was selected is kept and recursed into;
 *   - a REAL child that was not selected is dropped (it is copied by its own
 *     root fragment when it was selected) (2026-10-18).
 * @param {!Element} xml The <block>/<shadow> element to prune.
 * @param {!Set<string>} selectionIds The ids of the selected blocks.
 * @private
 */
Blockly.scratchBlocksUtils.pruneUnselected_ = function(xml, selectionIds) {
  var toRemove = [];
  for (var i = 0; i < xml.childNodes.length; i++) {
    var child = xml.childNodes[i];
    if (child.nodeType !== 1) {
      continue;
    }
    var tag = child.tagName.toLowerCase();
    if (tag !== 'next' && tag !== 'value' && tag !== 'statement') {
      continue;
    }
    // The single attached block/shadow inside the connection element.
    var blockChild = null;
    for (var j = 0; j < child.childNodes.length; j++) {
      if (child.childNodes[j].nodeType === 1) {
        blockChild = child.childNodes[j];
        break;
      }
    }
    if (!blockChild) {
      continue;  // empty connection: leave it be
    }
    if (blockChild.tagName.toLowerCase() === 'shadow') {
      continue;  // a shadow is the container's own filler: always keep
    }
    var childId = blockChild.getAttribute('id');
    if (selectionIds.has(childId)) {
      Blockly.scratchBlocksUtils.pruneUnselected_(blockChild, selectionIds);
    } else {
      toRemove.push(child);  // unselected real block: drop it from this copy
    }
  }
  for (var k = 0; k < toRemove.length; k++) {
    xml.removeChild(toRemove[k]);
  }
};

/**
 * Count the box-selected blocks the way the "Delete X Blocks" / "Duplicate X
 * Blocks" labels should: a value-input reporter (an operator plugged into a
 * socket) is an argument, not a standalone block, so it is not counted
 * (2026-10-18).  A block with an output connection is exactly such a reporter;
 * hat / stack / C / statement blocks have none, so they are the "积木" that
 * matter.
 * @param {!Array<!Blockly.BlockSvg>} blocks The box-selected blocks.
 * @return {number} The number of blocks without an output connection.
 * @package
 */
Blockly.scratchBlocksUtils.countSelectionBlocks = function(blocks) {
  var count = 0;
  for (var i = 0, block; block = blocks[i]; i++) {
    if (!block.outputConnection) {
      count++;
    }
  }
  return count;
};

/**
 * Creates a callback for the "duplicate selection" context menu option.  Every
 * block in the box selection is duplicated (each top-level fragment as a whole
 * stack), and the copies are attached to the mouse and dragged together, exactly
 * like duplicateAndDragCallback but for the whole selection.  Clicking the mouse
 * releases the new dragging blocks.
 * @param {!Array<!Blockly.BlockSvg>} blocks The box-selected blocks.
 * @param {!Event} event Event that caused the context menu to open.
 * @return {Function} A callback that duplicates the blocks and starts a drag.
 * @package
 */
Blockly.scratchBlocksUtils.duplicateSelectionAndDragCallback =
    function(blocks, event) {
  var isMouseEvent = Blockly.Touch.getTouchIdentifierFromEvent(event) === 'mouse';
  return function(e) {
    // Give the context menu a chance to close.
    setTimeout(function() {
      if (!blocks.length) {
        return;
      }
      var ws = blocks[0].workspace;
      // The minimal set of fragments to copy: a block whose parent is also in the
      // selection (a stack predecessor, or an input/statement container) is part
      // of that parent's fragment, so only copy blocks with no selected parent.
      var selectionSet = new Set(blocks);
      var roots = blocks.filter(function(b) {
        var parent = b.getParent();
        return !parent || !selectionSet.has(parent);
      });
      // Ids of the selected blocks, for quick membership tests against the
      // serialized XML (which carries block ids as strings, 2026-10-18).
      var selectionIds = new Set();
      selectionSet.forEach(function(b) {
        selectionIds.add(b.id);
      });

      // The target workspace would normally resize during domToBlock, which leads
      // to weird jumps.  Resizing is enabled again when the drag ends.
      ws.setResizesEnabled(false);
      Blockly.Events.disable();
      var newRoots = [];
      try {
        // One copy per root.  blockToDom serialises everything below `head`, so
        // prune every unselected block from the connection subtree (next / value
        // / statement) before rebuilding: a box-select gap — a deselected block
        // between two selected stacked blocks, or a C block kept while a block
        // inside its body is deselected — must not leak into the copy (2026-10-18).
        for (var j = 0; j < roots.length; j++) {
          var head = roots[j];
          var xml = Blockly.Xml.blockToDom(head);
          Blockly.scratchBlocksUtils.pruneUnselected_(xml, selectionIds);
          var newBlock = Blockly.Xml.domToBlock(xml, ws);
          // Scratch-specific: give shadow dom new IDs to prevent duplicating on
          // paste.
          Blockly.scratchBlocksUtils.changeObscuredShadowIds(newBlock);
          var oldPos = head.getRelativeToSurfaceXY();
          newBlock.moveBy(oldPos.x, oldPos.y);
          newRoots.push(newBlock);
        }
      } finally {
        Blockly.Events.enable();
      }
      if (Blockly.Events.isEnabled()) {
        for (var k = 0; k < newRoots.length; k++) {
          Blockly.Events.fire(new Blockly.Events.BlockCreate(newRoots[k]));
        }
      }

      if (isMouseEvent) {
        // e is not a real mouseEvent/touchEvent/pointerEvent.  It's an event
        // created by the context menu and has the coordinates of the mouse click
        // that opened the context menu.
        var fakeEvent = {
          clientX: event.clientX,
          clientY: event.clientY,
          type: 'mousedown',
          preventDefault: function() {
            e.preventDefault();
          },
          stopPropagation: function() {
            e.stopPropagation();
          },
          target: e.target
        };
        ws.startDragWithFakeEventForBlocks(fakeEvent, newRoots);
      } else {
        // Touch has no cursor to follow, so just place the copies offset and
        // re-enable resizing.
        for (var t = 0; t < newRoots.length; t++) {
          newRoots[t].moveBy(ws.RTL ? -100 : 100, 100);
        }
        ws.setResizesEnabled(true);
      }
    }, 0);
  };
};
