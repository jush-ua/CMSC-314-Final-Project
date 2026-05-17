import glob
for f in glob.glob('web/**/*.js', recursive=True):
    s=open(f,encoding='utf-8').read()
    bt=s.count('`')
    if bt%2!=0:
        print(f, 'backticks', bt)
    else:
        if bt>0:
            print(f, 'backticks', bt)
