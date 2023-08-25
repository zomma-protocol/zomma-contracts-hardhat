//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./libraries/SafeDecimalMath.sol";
import "./Vault.sol";
import "./Config.sol";

contract RewardDistributor is OwnableUpgradeable {
  using SafeERC20 for IERC20;
  using Address for address;

  mapping (uint256 => bool) public claimed;
  Vault public vault;

  event Claim(uint id);

  function initialize(address _vault) external initializer {
    __Ownable_init();
    vault = Vault(_vault);
  }

  function withdrawToken(address _token) external onlyOwner {
    IERC20(_token).safeTransfer(msg.sender, IERC20(_token).balanceOf(address(this)));
  }

  function withdraw() external onlyOwner {
    payable(msg.sender).transfer(address(this).balance);
  }

  function withdrawFromVault(uint amount) external onlyOwner {
    internalWithdrawFromVault(amount);
  }

  function claim(uint[] calldata data) external {
    uint length = data.length;
    require(length % 6 == 0, 'invalid length');
    uint total = 0;
    for (uint i = 0; i < length; i += 6) {
      uint id = data[i];
      require(!claimed[id], 'claimed');
      address receiver = address(uint160(data[i + 1]));
      require(receiver == msg.sender, 'invalid receiver');
      uint amount = data[i + 2];
      bytes32 hash = keccak256(abi.encodePacked(address(this), id, receiver, amount));
      address signer = ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)), uint8(data[i + 3]), bytes32(data[i + 4]), bytes32(data[i + 5]));
      require(signer == owner(), "invalid signature");
      total += amount;
      claimed[id] = true;
      emit Claim(id);
    }
    internalWithdrawFromVault(total);
  }

  function transfer(address to, uint amount) private {
    Config config = Config(vault.config());
    address quote = config.quote();
    uint quoteDecimal = config.quoteDecimal();
    IERC20(quote).safeTransfer(to, (amount * 10**quoteDecimal) / SafeDecimalMath.UNIT);
  }

  function internalWithdrawFromVault(uint amount) private {
    bytes memory data = abi.encodePacked(abi.encodeWithSelector(vault.withdraw.selector, amount), getData());
    address(vault).functionCall(data);
    transfer(msg.sender, amount);
  }

  function getData() private pure returns (bytes memory) {
    uint dataLength = getDataLength();
    uint leng = 32 * dataLength;
    bytes memory data = new bytes(leng);
    assembly {
      calldatacopy(add(data, 32), sub(calldatasize(), leng), leng)
    }
    return data;
  }

  function getDataLength() private pure returns (uint) {
    uint dataLength;
    assembly {
      dataLength := calldataload(
        sub(calldatasize(), 32)
      )
    }
    return dataLength;
  }
}
