//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

contract LnLookup {
  bool public frozenLn;

  mapping(uint => int) public LN;

  function freezeLn() external {
    frozenLn = true;
  }

  function setLn(uint[] memory keys, int[] memory values) external {
    require(!frozenLn, "frozen");
    require(keys.length == values.length, "incorrect length");
    uint length = keys.length;
    for (uint i = 0; i < length; ++i) {
      LN[keys[i]] = values[i];
    }
  }

  function ln(uint x) public view returns (int) {
    uint x1;
    uint x2;
    if (x > 2000000000000000000) {
      x2 = 2000000000000000000;
      x1 = 1990000000000000000;
    } else if (x < 10000000000000000) {
      x1 = 10000000000000000;
      x2 = 20000000000000000;
    } else {
      x1 = x - (x % 10000000000000000);
      x2 = x1 + 10000000000000000;
    }

    if (x1 == x) {
      return LN[x];
    }
    int v1 = LN[x1];
    int v2 = LN[x2];
    return v1 + (v2 - v1) * (int(x) - int(x1)) / (int(x2) - int(x1));
  }
}
