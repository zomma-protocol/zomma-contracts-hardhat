//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

contract CdfLookup {
  bool public frozenCdf;

  mapping(uint => uint) public CDF;

  function freezeCdf() external {
    frozenCdf = true;
  }

  function setCdf(uint[] calldata keys, uint[] calldata values) external {
    require(!frozenCdf, "frozen");
    require(keys.length == values.length, "incorrect length");
    uint length = keys.length;
    for (uint i; i < length;) {
      CDF[keys[i]] = values[i];
      unchecked { ++i; }
    }
  }

  function cdf(int x) public view returns (uint) {
    uint ux = uint(x < 0 ? -x : x);
    uint x1;
    uint x2;
    if (ux > 4000000000000000000) {
      x2 = 4000000000000000000;
      x1 = 3990000000000000000;
    } else {
      x1 = ux - (ux % 10000000000000000);
      x2 = x1 + 10000000000000000;
    }

    uint v;
    if (x1 == ux) {
      v = CDF[ux];
    } else {
      uint v1 = CDF[x1];
      uint v2 = CDF[x2];
      v = v1 + (v2 - v1) * (ux - x1) / (x2 - x1);
    }
    v = v > 1000000000000000000 ? 1000000000000000000 : v;
    return x < 0 ? 1000000000000000000 - v : v;
  }
}
