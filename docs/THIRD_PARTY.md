# Attribution and interface references

The Daemon coin and its five expressions in `web/src/Cat.tsx` are original SVG artwork for this assignment. The favicon and share image are generated from that artwork. No stock or AI-generated raster character is used.

- Better Interface guidance: Jakub Krehel, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`, MIT. The pinned IMD adaptation was used for implementation and the six-domain review.
- Design documentation method: Paul Bakaus, Impeccable, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`, Apache-2.0. `DESIGN.md` is an implementation-specific adaptation of that method. Copyright 2025 Paul Bakaus. Licenses for both guides are retained in [licenses/better-interface.txt](licenses/better-interface.txt).
- Ethereum frontend guidance: Austin Griffith / ethskills.com, commit `06ea4efa08076ff04f6ca4945ef4a2ca881115b0`, MIT, supplied through the pinned worker adaptation. [License](licenses/eth-frontend-ux.txt).
- DM Sans and Fraunces are distributed through the pinned Fontsource packages under the SIL Open Font License. Their notices, along with the installed frontend packages’ notices, are retained in [licenses/frontend-dependencies.txt](licenses/frontend-dependencies.txt).
- MetaMask, Rabby and Phantom marks are copied from RainbowKit 2.2.11’s published wallet SVG assets. [RainbowKit license](licenses/rainbowkit.txt). The Coinbase mark follows the pinned wallet connector reference. These marks identify their respective wallet providers; no affiliation is implied.

Protocol interface shapes were checked against primary sources:

- [Uniswap IV4Quoter](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Quoter.sol), for the read-only quote call.
- [Uniswap IV4Router](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Router.sol), for swap parameter naming; the supplied network flag determines the deployed tuple version.
- [Uniswap IPoolManager](https://github.com/Uniswap/v4-core/blob/main/src/interfaces/IPoolManager.sol), for Swap and Initialize events.
- [Rabby Mobile universal-link handler](https://github.com/RabbyHub/rabby-mobile/blob/develop/apps/mobile/src/hooks/universalLink.ts), for `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=…`.

These external references provide no deployment addresses. All runtime addresses and RPCs come from the supplied, attested deployment/network configuration. Wallet integration uses the pinned local connector reference and the installed wagmi/Coinbase SDK types.
