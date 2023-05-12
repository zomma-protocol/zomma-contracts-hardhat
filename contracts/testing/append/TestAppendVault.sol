//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../../append/AppendVault.sol";

contract TestAppendVault is AppendVault {
  uint public timestamp;

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
