# Scripts

A grab-bag of scripts. Make it easier to write a one-off script in TypeScript.

```sh
bin/index.sh hello-world
```

This executes the most basic command, you can go from there.

## Fava server

You need to make the logs output folder

```sh
mkdir -p /home/zahanm/log/fava-server/
```

And this goes in `crontab -e`

```
@hourly /home/zahanm/source/scripts/bin/index.sh update-fava-server /home/zahanm/source/accounts/ >> /home/zahanm/log/fava-server/out.log 2>> /home/zahanm/log/fava-server/err.log
```

## Pulling an updated script in on remote machine

In the case of `downloadFromPutio.py`

```sh
curl --output scripts/downloadFromPutio.py https://raw.githubusercontent.com/zahanm/scripts/master/python/downloadFromPutio.py
```
