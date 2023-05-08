// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.
require('dotenv').config();
const { ethers, upgrades } = require('hardhat');

async function logProxy(label, proxy) {
  console.log(`# ${label} Admin`, (await upgrades.erc1967.getAdminAddress(proxy.address)).toLocaleLowerCase());
  console.log(`# ${label} Implementation`, (await upgrades.erc1967.getImplementationAddress(proxy.address)).toLocaleLowerCase());
}

async function main() {
  const orig = await ethers.getContractAt('OptionPricer', process.env.OPTION_PRICER);
  console.log('proxy', process.env.OPTION_PRICER);
  await logProxy('Original', orig);

  const OptionPricer = await ethers.getContractFactory('TestUpgradeOptionPricer');
  console.log(`deploy OptionPricer...`);
  const proxy = await upgrades.upgradeProxy(process.env.OPTION_PRICER, OptionPricer);
  console.log(proxy.address.toLocaleLowerCase());
  await logProxy('New', proxy);;
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
