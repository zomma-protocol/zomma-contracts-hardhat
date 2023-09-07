//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./libraries/SafeDecimalMath.sol";
import "./Vault.sol";
import "./Config.sol";

error InvalidLength();
error Claimed();
error InvalidReceiver();
error InvalidSignature();

contract RewardDistributor is OwnableUpgradeable, EIP712Upgradeable {
  using SafeERC20 for IERC20;
  using Address for address;

  // keccak256("Claim(uint256 id,address receiver,uint256 amount)")
  bytes32 private constant CLAIM_TYPEHASH = 0x13ed777f4e2c93099d3703a23f12c4b95cd8c3a8fb33a7f02832f607d088fb27;
  uint private constant ONE = 1 ether;

  mapping(uint => uint) public claimed;
  Vault public vault;

  event Claim(uint id);

  constructor() {
    _disableInitializers();
  }

  function initialize(address _vault) external initializer {
    __Ownable_init();
    __EIP712_init("RewardDistributor", "1");
    vault = Vault(_vault);
  }

  function withdrawToken(address _token) external payable onlyOwner {
    IERC20(_token).safeTransfer(msg.sender, IERC20(_token).balanceOf(address(this)));
  }

  function withdraw() external payable onlyOwner {
    payable(msg.sender).transfer(address(this).balance);
  }

  function withdrawFromVault(uint amount) external payable onlyOwner {
    internalWithdrawFromVault(amount);
  }

  function claim(uint[] calldata data) external {
    uint length = data.length;
    if (length % 6 != 0) {
      revert InvalidLength();
    }

    uint total;
    for (uint i; i < length;) {
      uint id = data[i];
      if (claimed[id] != 0) {
        revert Claimed();
      }

      uint amount;
      unchecked {
        address receiver = address(uint160(data[i + 1]));
        if (receiver != msg.sender) {
          revert InvalidReceiver();
        }

        amount = data[i + 2];
        verifySignature(id, receiver, amount, uint8(data[i + 3]), bytes32(data[i + 4]), bytes32(data[i + 5]));
      }

      total += amount;
      claimed[id] = 1;
      emit Claim(id);

      unchecked {
        i += 6;
      }
    }
    internalWithdrawFromVault(total);
  }

  function transfer(address to, uint amount) private {
    Config config = Config(vault.config());
    address quote = config.quote();
    uint quoteDecimal = config.quoteDecimal();
    IERC20(quote).safeTransfer(to, (amount * 10**quoteDecimal) / ONE);
  }

  function internalWithdrawFromVault(uint amount) private {
    bytes memory data = abi.encodePacked(abi.encodeWithSelector(vault.withdraw.selector, amount), getData());
    address(vault).functionCall(data);
    transfer(msg.sender, amount);
  }

  function getData() private pure returns (bytes memory) {
    uint dataLength = getDataLength();
    uint leng = dataLength << 5;
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

  function verifySignature(uint id, address receiver, uint amount, uint8 v, bytes32 r, bytes32 s) private view {
    bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, id, receiver, amount)));
    address signer = ECDSAUpgradeable.recover(digest, v, r, s);
    if (signer != owner()) {
      revert InvalidSignature();
    }
  }
}
