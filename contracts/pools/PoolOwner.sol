//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./Pool.sol";

contract PoolOwner is OwnableUpgradeable, AccessControlUpgradeable {
  using SafeERC20 for IERC20;
  using Address for address;

  // 0x7a8dc26796a1e50e6e190b70259f58f6a4edd5b22280ceecc82b687b8e982869
  bytes32 private constant WITHDRAW_ROLE = keccak256("WITHDRAW");

  address public pool;

  fallback() external {
    bytes memory ret;
    bytes4 selector = msg.sig;
    if (selector == Pool.withdrawBySignature.selector) {
      ret = roleCall(WITHDRAW_ROLE);
    } else {
      ret = ownerCall();
    }
    assembly {
      return(add(ret, 0x20), mload(ret))
    }
  }

  function initialize(address _pool) external initializer {
    __Ownable_init();
    _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    _setupRole(WITHDRAW_ROLE, msg.sender);
    pool = _pool;
  }

  function withdrawToken(address _token) external payable onlyOwner {
    IERC20(_token).safeTransfer(msg.sender, IERC20(_token).balanceOf(address(this)));
  }

  function withdraw() external payable onlyOwner {
    payable(msg.sender).transfer(address(this).balance);
  }

  function ownerCall() private onlyOwner returns(bytes memory) {
    return pool.functionCall(msg.data);
  }

  function roleCall(bytes32 role) private onlyRole(role) returns(bytes memory)  {
    return pool.functionCall(msg.data);
  }
}
