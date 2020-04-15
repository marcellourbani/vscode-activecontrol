# ActiveControl Transport form creator

This plugin automates transport form creation using ActiveControl web gui

## Features

- pops up a transport form creation window when a transport without one is used
- exposes a command to create it manually

> Note: this works by creating a local unencrypted proxy server. Your credentials will be exchanged unencrypted, although only in your machine

## Requirements

Only makes sense if you use [ActiveControl](https://www.basistechnologies.com/products/activecontrol/) and [ABAP remote filesystem](https://marketplace.visualstudio.com/items?itemName=murbani.vscode-abap-remote-fs)

## Extension Settings

- **port** the port the local proxy will use
- **url** the activecontrol base URL
- **user** you username on the AC domain controller

## License

[MIT](LICENSE.md) &copy; 2020 Marcello Urbani

This is a personal project, not supported by Basis Technologies
