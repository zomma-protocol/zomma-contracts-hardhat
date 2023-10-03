//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "../../signed/SignedVault.sol";

contract TestSignedVault is SignedVault {
  uint private timestamp;

  function setTimestamp(uint _timestamp) external {
    timestamp = _timestamp;
  }

  function getTimestampPublic() external view returns (uint) {
    return getTimestamp();
  }

  function getTimestamp() internal view override returns (uint) {
    return timestamp == 0 ? block.timestamp : timestamp;
  }
}
