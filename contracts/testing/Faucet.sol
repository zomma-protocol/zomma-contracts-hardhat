//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IMintableERC20 is IERC20 {
  function mint(address account, uint amount) external;
}

contract Faucet is Ownable {
  mapping(address => bool) public tokenClaimed;
  mapping(address => bool) public claimed;
  uint private amount = 0.01 ether;
  uint private tokenAmount = 10000 * 10**6;
  IMintableERC20 private token;

  constructor(address _token) {
    token = IMintableERC20(_token);
  }

  receive() external payable {
  }

  function setAmount(uint _amount) external onlyOwner {
    amount = _amount;
  }

  function setTokenAmount(uint _tokenAmount) external onlyOwner {
    tokenAmount = _tokenAmount;
  }

  function withdraw() external onlyOwner {
    payable(owner()).transfer(address(this).balance);
  }

  function claim(address payable user) external onlyOwner {
    require(!claimed[user], "can only claim once");
    require(address(this).balance >= amount, "insufficient balance");
    claimed[user] = true;
    user.transfer(amount);
  }

  function claimToken() external {
    require(!tokenClaimed[msg.sender], "can only claim once");
    tokenClaimed[msg.sender] = true;
    token.mint(msg.sender, tokenAmount);
  }
}
