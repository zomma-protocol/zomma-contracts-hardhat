# Zomma Contracts
## Installation
```Shell
npm install
```

## Run Tests
```Shell
npx hardhat test
```
With gas report
```Shell
REPORT_GAS=true npx hardhat test
```
Code coverage
```Shell
npx hardhat coverage
```

## Environment
Should set up environment before deployment
```
# if it is production
# PRODUCTION=1

DEPLOYER=0xDD980c315dFA75682F04381E98ea38BD2A151540
# private key
PK=4b....

STAKEHOLDER=0xDD980c315dFA75682F04381E98ea38BD2A151540
INSURANCE=0xDD980c315dFA75682F04381E98ea38BD2A151540

# normal, lookup, signed
OPTION_PRICER_TYPE=signed
# normal, signed
VAULT_TYPE=signed

# usdc token address
# USDC=

# Set these addersses. It won't deploy everytime.
# SPOT_PRICER=
# OPTION_PRICER=
# FACTORY=
# FAUCET=
# SETTLER=

# chainlink proxy address when using chainlink
# CHAINLINK_PROXY=
```

## Deployment
Deployment test
```Shell
npx hardhat run scripts/deploy.js
```
Deployment ganache, change to other networks
```Shell
npx hardhat --network ganache run scripts/deploy.js
```

## zkSync Deployment
Compile first
```Shell
npx hardhat --network zkSync compile
```
Deployment testnet
```Shell
npx hardhat --network zkSyncTestnet deploy-zksync
```
Deployment mainnet
```Shell
npx hardhat --network zkSync deploy-zksync
```
