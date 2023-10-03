//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "../../../signed/pools/SignedPool.sol";
import "../TestSignedVault.sol";

contract TestSignedPool is SignedPool {
  function getTimestamp() internal view override returns (uint) {
    return TestSignedVault(address(vault)).getTimestampPublic();
  }
}
