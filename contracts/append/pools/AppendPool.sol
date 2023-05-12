//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/utils/Address.sol";
import "../../interfaces/IVault.sol";
import "../../pools/Pool.sol";

contract AppendPool is Pool {
  using Address for address;

  function getAccountInfo(address addr) internal view override returns (IVault.AccountInfo memory) {
    bytes memory extra = getData();
    bytes memory data = abi.encodePacked(abi.encodeWithSelector(vault.getAccountInfo.selector, addr), extra);
    bytes memory returnData = address(vault).functionStaticCall(data);
    // (bool success, bytes memory returnData) = address(vault).staticcall(data);
    // if (!success) {
    //   revert();
    // }
    return abi.decode(returnData, (IVault.AccountInfo));
  }

  function internalDeposit(uint amount) internal override {
    bytes memory extra = getData();
    bytes memory data = abi.encodePacked(abi.encodeWithSelector(vault.deposit.selector, amount), extra);
    address(vault).functionCall(data);
    // (bool success, bytes memory returnData) = address(vault).call(data);
    // if (!success) {
    //   revert();
    // }
  }

  function withdrawPercent(uint rate, uint acceptableAmount, uint _freeWithdrawableRate) internal override returns (uint) {
    bytes memory extra = getData();
    bytes memory data = abi.encodePacked(abi.encodeWithSelector(vault.withdrawPercent.selector, rate, acceptableAmount, _freeWithdrawableRate), extra);
    bytes memory returnData = address(vault).functionCall(data);
    // (bool success, bytes memory returnData) = address(vault).call(data);
    // if (!success) {
    //   revert();
    // }
    return abi.decode(returnData, (uint));
  }

  function getData() internal pure returns (bytes memory) {
    uint lastData = getLastData();
    uint leng = 32 * lastData;
    bytes memory data = new bytes(leng);
    assembly {
      calldatacopy(add(data, 32), sub(calldatasize(), leng), leng)
    }
    return data;
  }

  function getLastData() internal pure returns (uint) {
    uint lastData;
    assembly {
      lastData := calldataload(
        sub(calldatasize(), 32)
      )
    }
    return lastData;
  }
}
