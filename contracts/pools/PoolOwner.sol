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
  using Address for address payable;

  // 0x7a8dc26796a1e50e6e190b70259f58f6a4edd5b22280ceecc82b687b8e982869
  bytes32 private constant WITHDRAW_ROLE = keccak256("WITHDRAW");

  // 0xeb33521169e672634fcae38dcc3bab0be8a080072000cfbdc0e041665d727c18
  bytes32 private constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR");

  address public pool;

  fallback() external {
    bytes memory ret;
    bytes4 selector = msg.sig;
    if (selector == Pool.withdrawBySignature.selector) {
      ret = roleCall(WITHDRAW_ROLE);
    } else if (selector == Pool.deposit.selector || selector == Pool.withdraw.selector) {
      ret = roleCall(LIQUIDATOR_ROLE);
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
    pool = _pool;
    internalApprovePool();
  }

  function transferPoolOwnership(address newOwner) public virtual onlyOwner {
    Pool(pool).transferOwnership(newOwner);
  }

  function withdrawToken(address _token) external payable onlyOwner {
    IERC20(_token).safeTransfer(msg.sender, IERC20(_token).balanceOf(address(this)));
  }

  function withdraw() external payable onlyOwner {
    payable(msg.sender).sendValue(address(this).balance);
  }

  function approvePool() external payable onlyOwner {
    internalApprovePool();
  }

  function withdrawTokenByLiquidator(uint amount) external payable onlyRole(LIQUIDATOR_ROLE) {
    Pool(pool).quoteAsset().safeTransfer(msg.sender, amount);
  }

  function ownerCall() private onlyOwner returns(bytes memory) {
    return pool.functionCall(msg.data);
  }

  function roleCall(bytes32 role) private onlyRole(role) returns(bytes memory)  {
    return pool.functionCall(msg.data);
  }

  function internalApprovePool() private {
    Pool(pool).quoteAsset().forceApprove(pool, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
  }
}
