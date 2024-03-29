//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/Address.sol";
import "../../interfaces/IVault.sol";
import "../../pools/Pool.sol";

/**
* @dev Append signed data for signed data version Vault.
*/
contract SignedPool is Pool {
  using Address for address;

  function internalWithdraw(uint shares, uint acceptableAmount, uint deadline, uint gasFee, address account, address gasReceiver) internal override {
    super.internalWithdraw(shares, acceptableAmount, deadline, gasFee, account, gasReceiver);
    if (getSkipCheckOwner() != 1) {
      _checkOwner();
    }
  }

  function getAccountInfo(address addr) internal view override returns (IVault.AccountInfo memory) {
    bytes memory data = abi.encodePacked(abi.encodeWithSelector(vault.getAccountInfo.selector, addr), getData());
    bytes memory returnData = address(vault).functionStaticCall(data);
    return abi.decode(returnData, (IVault.AccountInfo));
  }

  function internalDeposit(uint amount) internal override {
    bytes memory data = abi.encodePacked(abi.encodeWithSelector(vault.deposit.selector, amount), getData());
    address(vault).functionCall(data);
  }

  function withdrawPercent(uint rate, uint acceptableAmount, uint _freeWithdrawableRate) internal override returns (uint) {
    bytes memory data = abi.encodePacked(abi.encodeWithSelector(vault.withdrawPercent.selector, rate, acceptableAmount, _freeWithdrawableRate), getData());
    bytes memory returnData = address(vault).functionCall(data);
    return abi.decode(returnData, (uint));
  }

  function getData() internal pure returns (bytes memory) {
    uint dataLength = getDataLength();
    uint dataBytes = dataLength << 5;
    bytes memory data = new bytes(dataBytes);
    assembly {
      calldatacopy(add(data, 32), sub(calldatasize(), dataBytes), dataBytes)
    }
    return data;
  }

  function getDataLength() internal pure returns (uint) {
    uint dataLength;
    assembly {
      dataLength := calldataload(
        sub(calldatasize(), 32)
      )
    }
    return dataLength;
  }

  function getSkipCheckOwner() internal pure returns (uint skipCheckOwner) {
    uint dataLength = getDataLength();
    uint dataBytes = dataLength << 5;
    assembly {
      skipCheckOwner := calldataload(add(sub(calldatasize(), dataBytes), 128))
    }
  }
}
