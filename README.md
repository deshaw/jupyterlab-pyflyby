# @deshaw/jupyterlab_pyflyby

![Github Actions Status](https://github.com/deshaw/jupyterlab-pyflyby.git/workflows/Build/badge.svg)

A labextension to integrate pyflyby with notebooks

[Pyflyby](https://github.com/deshaw/pyflyby) helps you get rid of the tedious task of recalling and adding import statements. This labextension takes it further by adding the import statements automatically in your notebook. For eg. executing `np.arange(10)`

![Screenshot](https://github.com/deshaw/jupyterlab-pyflyby/blob/main/docs/pyflyby.gif 'PyFlyBy')

You can decide cell where imports should be added by adding 'pyflyby-cell' cell tag to it.

## Requirements

- JupyterLab >= 3.0

## Install

```bash
pip install jupyterlab_pyflyby
```

## Contributing

### Development install

Note: You will need NodeJS to build the extension package.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash
# Clone the repo to your local environment
# Change directory to the jupyterlab_pyflyby directory
# Install package in development mode
pip install -e .
# Link your development version of the extension with JupyterLab
jupyter-labextension develop . --overwrite
# Rebuild extension Typescript source after making changes
jlpm run build
```

You can watch the source directory and run JupyterLab at the same time in different terminals to watch for changes in the extension's source and automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm run watch
# Run JupyterLab in another terminal
jupyter-lab
```

With the watch command running, every saved change will immediately be built locally and available in your running JupyterLab. Refresh JupyterLab to load the change in your browser (you may need to wait several seconds for the extension to be rebuilt).

By default, the `jlpm run build` command generates the source maps for this extension to make it easier to debug using the browser dev tools. To also generate source maps for the JupyterLab core extensions, you can run the following command:

```bash
jupyter lab build --minimize=False
```

#### Publishing

Before starting, you'll need to have run: `pip install twine jupyter_packaging`

1. Update the version in `package.json` and update the release date in `CHANGELOG.md`
2. Commit the change in step 1, tag it, then push it
```
git commit -am <msg>
git tag vX.Z.Y
git push && git push --tags
```
3. Create the artifacts
```
rm -rf dist
python setup.py sdist bdist_wheel
```
4. Test this against the test pypi. You can then install from here to test as well:
```
twine upload --repository-url https://test.pypi.org/legacy/ dist/*
# In a new venv
pip install --index-url https://test.pypi.org/simple/ jupyterlab_pyflyby
```
5. Upload this to pypi:
```
twine upload dist/*
```

### Uninstall

```bash
pip uninstall jupyterlab_pyflyby
```

## History

This plugin was contributed back to the community by the [D. E. Shaw group](https://www.deshaw.com/).

<p align="center">
    <a href="https://www.deshaw.com">
       <img src="https://www.deshaw.com/assets/logos/blue_logo_417x125.png" alt="D. E. Shaw Logo" height="75" >
    </a>
</p>

## License

This project is released under a [BSD-3-Clause license](https://github.com/deshaw/jupyterlab-pyflyby/blob/master/LICENSE.txt).

"Jupyter" is a trademark of the NumFOCUS foundation, of which Project Jupyter is a part.
