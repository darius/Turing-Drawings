/*****************************************************************************
*
*  This file is part of the Turing-Drawings project. The project is
*  distributed at:
*  https://github.com/maximecb/Turing-Drawings
*
*  Copyright (c) 2012, Maxime Chevalier-Boisvert. All rights reserved.
*
*  This software is licensed under the following license (Modified BSD
*  License):
*
*  Redistribution and use in source and binary forms, with or without
*  modification, are permitted provided that the following conditions are
*  met:
*   1. Redistributions of source code must retain the above copyright
*      notice, this list of conditions and the following disclaimer.
*   2. Redistributions in binary form must reproduce the above copyright
*      notice, this list of conditions and the following disclaimer in the
*      documentation and/or other materials provided with the distribution.
*   3. The name of the author may not be used to endorse or promote
*      products derived from this software without specific prior written
*      permission.
*
*  THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESS OR IMPLIED
*  WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
*  MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN
*  NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
*  INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
*  NOT LIMITED TO PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
*  DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
*  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
*  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
*  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*
*****************************************************************************/

'use strict';

var ACTION_LEFT  = 0;
var ACTION_RIGHT = 1;
var ACTION_UP    = 2;
var ACTION_DOWN  = 3;
var NUM_ACTIONS  = 4;

/*
N states, one start state
K symbols
4 actions (left, right up, down)

N x K -> N x K x A
*/
function Program(numStates, numSymbols, mapWidth, mapHeight)
{
    assert (
        numStates >= 1,
        'must have at least 1 state'
    );
    
    assert (
        numSymbols >= 2,
        'must have at least 2 symbols'
    );

    /// Number of states and symbols
    this.numStates = numStates;
    this.numSymbols = numSymbols;

    /// Image dimensions
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;

    /// Transition table
    this.table = new Int32Array(numStates * numSymbols * 3);

    /// Machine state:
    ///   2D tape in the first mapWidth*mapHeight cells; then
    ///   state, xPos, yPos
    /// (size is * 2 instead of + 3 to keep it a power of 2 as asm.js requires)
    this.heap = new Int32Array(mapWidth * mapHeight * 2); 
    assert((mapWidth & (mapWidth-1)) === 0, "must be a power of 2");
    assert((mapHeight & (mapHeight-1)) === 0, "must be a power of 2");

    // Generate random transitions
    for (var st = 0; st < numStates; ++st)
    {
        for (var sy = 0; sy < numSymbols; ++sy)
        {
            this.randomTrans(st, sy);
        }
    }

    // Initialize the state
    this.reset();
}

Program.prototype.setTrans = function (st0, sy0, st1, sy1, ac1)
{
    var idx = (this.numStates * sy0 + st0) * 3;

    this.table[idx + 0] = st1;
    this.table[idx + 1] = sy1;
    this.table[idx + 2] = ac1;

    delete this.update;
}

Program.prototype.getTrans = function (st0, sy0)
{
    var idx = (this.numStates * sy0 + st0) * 3;
    return {state:  this.table[idx+0],
            symbol: this.table[idx+1],
            act:    this.table[idx+2]};
}

Program.prototype.mutate = function ()
{
    this.randomTrans(randomInt(0, this.numStates - 1),
                     randomInt(0, this.numSymbols - 1));
}

Program.prototype.randomTrans = function (st, sy)
{
    this.setTrans(st,
                  sy,
                  randomInt(0, this.numStates - 1),
                  randomInt(1, this.numSymbols - 1),
                  randomInt(0, NUM_ACTIONS - 1));
}

Program.prototype.reset = function ()
{
    /// Iteration count
    this.itrCount = 0;

    // Initialize the image, state, and location
    for (var i = 0; i < this.heap.length; ++i)
        this.heap[i] = 0;
    this.heap[this.mapWidth*this.mapHeight+1] = this.mapWidth/2;  // x position
    this.heap[this.mapWidth*this.mapHeight+2] = this.mapHeight/2; // y position
}

Program.prototype.toString = function ()
{
    var str = this.numStates + ',' + this.numSymbols;

    for (var i = 0; i < this.table.length; ++i)
        str += ',' + this.table[i];

    return str;
}

Program.fromString = function (str, mapWidth, mapHeight)
{
    console.log(str);

    var nums = str.split(',').map(Number);

    var numStates  = nums[0];
    var numSymbols = nums[1];

    console.log('num states: ' + numStates);
    console.log('num symbols: ' + numSymbols);

    assert (
        numStates > 0 &&
        numSymbols > 0,
        'invalid input string'
    );

    var prog = new Program(numStates, numSymbols, mapWidth, mapHeight);

    assert (
        prog.table.length === nums.length - 2,
        'invalid transition table length'
    );

    for (var i = 0; i < prog.table.length; ++i)
        prog.table[i] = nums[i+2];

    return prog;
}

Program.prototype.update = function (numItrs)
{
    // N.B. If you ever mutate this.table, mapWidth, mapHeight, then
    // also delete this.update so it'll get regenerated here.
    // (0,eval) explained at
    // http://perfectionkills.com/global-eval-what-are-the-options/
    var linkUpdate = (0,eval)(asmgenerate(this));
    this.reallyUpdate = linkUpdate(window, null, this.heap.buffer);
    this.update = function(numItrs) {
        this.reallyUpdate(numItrs);
        this.itrCount += numItrs;
    };
    this.update(numItrs);
}

function perfectLog2(n) {
    var result = log2(n);
    assert(result === (result|0), "must be a power of 2");
    return result;
}

function log2(n) {
    return Math.log(n) / Math.log(2);
}

function asmgenerate(program)
{
    var mapWidth  = program.mapWidth;
    var mapHeight = program.mapHeight;
    var numStates = program.numStates;
    var table     = program.table;
    var after = mapWidth * mapHeight;
    var logMapWidth = perfectLog2(mapWidth);
    var logNumSymbols = Math.ceil(log2(program.numSymbols));

    var code = "";
    code += "(function(stdlib, foreign, heap) {\n";
    code += '"use asm";\n';
    code += "var heap32 = new stdlib.Int32Array(heap);\n";
    code += "function update(numItrs) {\n";
    code += "    numItrs = numItrs|0;\n";
    code += "    var state = 0;\n";
    code += "    var xPos  = 0;\n";
    code += "    var yPos  = 0;\n";
    code += "    var i     = 0;\n";
    code += "    var oldPos = 0;\n";

    code += "    state = heap32["+((after+0)<<2)+">>2]|0;\n";
    code += "    xPos  = heap32["+((after+1)<<2)+">>2]|0;\n";
    code += "    yPos  = heap32["+((after+2)<<2)+">>2]|0;\n";

    code += "    for (i = numItrs; 0 < (i|0); i = (i - 1)|0) {\n";
    code += "        oldPos = (((yPos<<"+logMapWidth+") + xPos)<<2)|0;\n";
    code += "        switch (((heap32[oldPos>>2]|0) + (state<<"+logNumSymbols+"))|0) {\n";
    for (var state = 0; state < numStates; ++state)
    {
        for (var symbol = 0; symbol < program.numSymbols; ++symbol)
        {   
            var next = program.getTrans(state, symbol);
            code += "        case "+(symbol + (state << logNumSymbols))+":\n";
            if (next.state !== state)
                code += "            state = "+next.state+";\n";
            if (next.symbol !== symbol)
                code += "            heap32[oldPos>>2] = "+next.symbol+";\n";
            switch (next.act)
            {
            case ACTION_LEFT:
                code += "            xPos = (xPos + 1)|0; if ((xPos|0) >= "+mapWidth+") xPos = (xPos - "+mapWidth+")|0;\n";
                break;
            case ACTION_RIGHT:
                code += "            xPos = (xPos - 1)|0; if ((xPos|0) < 0) xPos = (xPos + "+mapWidth+")|0;\n";
                break;
            case ACTION_UP:
                code += "            yPos = (yPos - 1)|0; if ((yPos|0) < 0) yPos = (yPos + "+mapHeight+")|0;\n";
                break;
            case ACTION_DOWN:
                code += "            yPos = (yPos + 1)|0; if ((yPos|0) >= "+mapHeight+") yPos = (yPos - "+mapHeight+")|0;\n";
                break;
            default:
                error('invalid action');
            }
            code += "            break;\n";
        }
    }
    code += "        }\n";
    code += "    }\n";
    code += "    heap32["+((after+0)<<2)+">>2] = state;\n";
    code += "    heap32["+((after+1)<<2)+">>2] = xPos;\n";
    code += "    heap32["+((after+2)<<2)+">>2] = yPos;\n";
    code += "}\n";
    code += "return update;\n";
    code += "})\n";
//    console.log(code);
    return code;
}
