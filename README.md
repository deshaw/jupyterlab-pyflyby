# @deshaw/jupyterlab-pyflyby

A labextension to integrate pyflyby with notebooks.

[Pyflyby](https://github.com/deshaw/pyflyby) helps you get rid of the tedious task of recalling and adding import statements. This labextension takes it further by adding the import statements automatically in your notebook. For eg. executing `np.arange(10)`

![Screenshot](https://github.com/deshaw/jupyterlab-pyflyby/blob/main/docs/pyflyby.gif "PyFlyBy")

You can decide cell where imports should be added by adding 'pyflyby-cell' cell tag to it.

## Install

```bash
pip install jupyterlab_pyflyby
jupyter lab build
```

## Working locally

```bash
pip install .
jupyter lab build
```

If you just want to try out changes in client-side extension -
```bash
cd ts
yarn
yarn build
jupyter labextension link .
```

## History

This plugin was contributed back to the community by the [D. E. Shaw group](https://www.deshaw.com/).

<p align="center">
    <a href="https://www.deshaw.com">
       <img src="https://www.deshaw.com/assets/logos/black_logo_417x125.png" alt="D. E. Shaw Logo" height="75" >
    </a>
</p>
